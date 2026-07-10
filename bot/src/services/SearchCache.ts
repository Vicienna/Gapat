// In-memory search result cache — reduces duplicate MCP/API calls
// With 1000 users, many will ask the same questions (bitcoin price, weather, etc.)

interface CacheEntry {
  result: string;
  timestamp: number;
}

class SearchCache {
  private cache = new Map<string, CacheEntry>();
  private ttlMs: number;
  private maxEntries: number;

  constructor(ttlSeconds: number, maxEntries: number) {
    this.ttlMs = ttlSeconds * 1000;
    this.maxEntries = maxEntries;
  }

  private normalizeKey(query: string): string {
    return query.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  get(query: string): string | null {
    const key = this.normalizeKey(query);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    return entry.result;
  }

  set(query: string, result: string): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    const key = this.normalizeKey(query);
    this.cache.set(key, { result, timestamp: Date.now() });
  }

  getStats() {
    return { entries: this.cache.size, maxEntries: this.maxEntries, ttlSeconds: this.ttlMs / 1000 };
  }

  clear(): void {
    this.cache.clear();
  }
}

// Cache search results for 5 minutes, max 500 entries
export const searchCache = new SearchCache(
  parseInt(process.env.SEARCH_CACHE_TTL || '300', 10),
  parseInt(process.env.SEARCH_CACHE_MAX || '500', 10)
);
