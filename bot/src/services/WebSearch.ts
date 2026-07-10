import ddgs from 'duck-duck-scrape';
import { mcpSearch } from './MCPClient';
import { searchCache } from './SearchCache';

interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

async function searchDDGS(query: string, maxResults: number): Promise<SearchResult[]> {
  const res = await ddgs.search(query, { safeSearch: ddgs.SafeSearchType.OFF });
  return (res.results || []).slice(0, maxResults).map((r: any) => ({
    title: r.title || '',
    snippet: r.description || '',
    url: r.url || '',
  }));
}

function formatResults(results: SearchResult[]): string {
  if (!results.length) return '';
  return results.map((r, i) =>
    `${i + 1}. **${r.title}**\n${r.snippet}\n${r.url}`
  ).join('\n\n');
}

export async function webSearch(query: string, maxResults = 5, userId?: string): Promise<string> {
  // Check cache first
  const cached = searchCache.get(query);
  if (cached) return cached;

  // Primary: MCP servers (user personal + system global)
  try {
    const mcpResult = await mcpSearch(query, maxResults, userId);
    if (mcpResult) {
      searchCache.set(query, mcpResult);
      return mcpResult;
    }
  } catch {}

  const errors: string[] = [];

  // Fallback: duck-duck-scrape (fast, no API key)
  try {
    const results = await searchDDGS(query, maxResults);
    const formatted = formatResults(results);
    if (formatted) {
      searchCache.set(query, formatted);
      return formatted;
    }
  } catch (e: any) {
    errors.push(`DuckDuckGo: ${e.message}`);
  }

  // Fallback: DuckDuckGo HTML lite
  try {
    const results = await searchDDGHtml(query, maxResults);
    const formatted = formatResults(results);
    if (formatted) {
      searchCache.set(query, formatted);
      return formatted;
    }
  } catch (e: any) {
    errors.push(`DDG HTML: ${e.message}`);
  }

  // Fallback: Bing
  try {
    const results = await searchBing(query, maxResults);
    const formatted = formatResults(results);
    if (formatted) {
      searchCache.set(query, formatted);
      return formatted;
    }
    if (formatted) return formatted;
  } catch (e: any) {
    errors.push(`Bing: ${e.message}`);
  }

  return `Search failed from all sources:\n${errors.join('\n')}`;
}

// ─── Fallback: DDG HTML scraping ────────────────────────────────

function fetchHtml(hostname: string, path: string, timeout = 10000): Promise<string> {
  const https = require('https') as typeof import('https');
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname, path, method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout,
      rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
    }, (res: any) => {
      let data = '';
      res.on('data', (c: string) => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function decodeEntities(t: string): string {
  return t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/');
}
function stripTags(t: string): string { return t.replace(/<[^>]*>/g, '').trim(); }

async function searchDDGHtml(query: string, max: number): Promise<SearchResult[]> {
  const html = await fetchHtml('html.duckduckgo.com', `/html/?q=${encodeURIComponent(query)}`);
  const results: SearchResult[] = [];
  // Try multiple DDG HTML formats
  const blocks = html.split(/class="result[_ ]?body"/);
  for (let i = 1; i < blocks.length && results.length < max; i++) {
    const b = blocks[i];
    const t = b.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
    const s = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const u = b.match(/class="result__a"[^>]+href="([^"]+)"/);
    if (t) {
      let url = u ? u[1] : '';
      // DuckDuckGo wraps URLs in redirect
      if (url.includes('uddg=')) {
        const m = url.match(/uddg=([^&]+)/);
        if (m) url = decodeURIComponent(m[1]);
      }
      results.push({
        title: decodeEntities(stripTags(t[1])),
        snippet: s ? decodeEntities(stripTags(s[1])) : '',
        url: decodeEntities(url),
      });
    }
  }
  return results;
}

async function searchBing(query: string, max: number): Promise<SearchResult[]> {
  const html = await fetchHtml('www.bing.com', `/search?q=${encodeURIComponent(query)}&setlang=en`);
  const results: SearchResult[] = [];
  const blocks = html.split('class="b_algo"');
  for (let i = 1; i < blocks.length && results.length < max; i++) {
    const b = blocks[i];
    const h2 = b.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const cite = b.match(/<cite[^>]*>([\s\S]*?)<\/cite>/i);
    const s = b.match(/<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
      || b.match(/<div[^>]*class="[^"]*b_caption[^"]*"[^>]*><p[^>]*>([\s\S]*?)<\/p>/i);
    if (h2) {
      const title = decodeEntities(stripTags(h2[1]));
      // Extract real URL from cite (Bing wraps actual URLs there)
      let url = cite ? decodeEntities(stripTags(cite[1])) : '';
      // Clean up cite format "https://example.com › path"
      url = url.replace(/ ›.*/, '').replace(/https?:\/\//, 'https://');
      results.push({
        title,
        snippet: s ? decodeEntities(stripTags(s[1])) : '',
        url,
      });
    }
  }
  return results;
}
