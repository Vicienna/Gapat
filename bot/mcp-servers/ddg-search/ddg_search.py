#!/usr/bin/env python3
"""
MCP Server for DuckDuckGo Search.
Implements the Model Context Protocol (MCP) over stdio with JSON-RPC 2.0.
Provides web_search and web_fetch tools.
"""
import sys, json, os, re, urllib.request, urllib.parse, html as htmlmod, ssl, select, time

def log(msg):
    print(f"[DDG-MCP] {msg}", file=sys.stderr, flush=True)

def send(obj):
    print(json.dumps(obj), flush=True)

def jsonrpc_response(id, result):
    return {"jsonrpc": "2.0", "id": id, "result": result}

def jsonrpc_error(id, code, message):
    return {"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}}

TOOLS = [
    {
        "name": "web_search",
        "description": "Search the web using DuckDuckGo. Returns a list of results with titles, URLs, and snippets.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query string"},
                "max_results": {"type": "integer", "description": "Max results (default 10)", "default": 10},
            },
            "required": ["query"],
        },
    },
    {
        "name": "web_fetch",
        "description": "Fetch and extract readable text from a URL.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "Full URL to fetch (must start with http:// or https://)"},
            },
            "required": ["url"],
        },
    },
]

def ddg_html_search(query, max_results=10):
    results = []
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        encoded = urllib.parse.quote_plus(query)
        url = f"https://html.duckduckgo.com/html/?q={encoded}"
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            "Accept": "text/html",
            "Accept-Language": "en-US,en;q=0.9",
        })
        resp = urllib.request.urlopen(req, timeout=10, context=ctx)
        body = resp.read().decode("utf-8", errors="replace")

        # Split by result blocks
        blocks = body.split('class="result__body"')
        for block in blocks[1:max_results + 1]:
            title_m = re.search(r'class="result__a"[^>]*>(.*?)</a>', block, re.DOTALL)
            url_m = re.search(r'class="result__a"[^>]+href="([^"]+)"', block)
            snippet_m = re.search(r'class="result__snippet"[^>]*>(.*?)</a>', block, re.DOTALL)

            if title_m and url_m:
                title = re.sub(r'<[^>]+>', '', htmlmod.unescape(title_m.group(1))).strip()
                raw_url = url_m.group(1)
                # DuckDuckGo wraps URLs in a redirect
                if 'uddg=' in raw_url:
                    parsed_qs = urllib.parse.parse_qs(urllib.parse.urlparse(raw_url).query)
                    raw_url = parsed_qs.get('uddg', [raw_url])[0]
                raw_url = htmlmod.unescape(raw_url)
                snippet = ''
                if snippet_m:
                    snippet = re.sub(r'<[^>]+>', '', htmlmod.unescape(snippet_m.group(1))).strip()
                results.append({"title": title, "url": raw_url, "snippet": snippet})

    except Exception as e:
        log(f"DDG HTML search failed: {e}")
    return results

def bing_search(query, max_results=10):
    results = []
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        encoded = urllib.parse.quote_plus(query)
        url = f"https://www.bing.com/search?q={encoded}&count={max_results}&setlang=en"
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            "Accept": "text/html",
            "Accept-Language": "en-US,en;q=0.9",
        })
        resp = urllib.request.urlopen(req, timeout=10, context=ctx)
        body = resp.read().decode("utf-8", errors="replace")

        blocks = body.split('class="b_algo"')
        for block in blocks[1:max_results + 1]:
            # Extract real URL from <cite> tag (Bing wraps actual URLs there)
            cite_m = re.search(r'<cite[^>]*>(.*?)</cite>', block, re.DOTALL)
            h2_m = re.search(r'<h2[^>]*>(.*?)</h2>', block, re.DOTALL)
            snippet_m = re.search(r'<p[^>]*>(.*?)</p>', block, re.DOTALL)

            if h2_m and cite_m:
                title = re.sub(r'<[^>]+>', '', htmlmod.unescape(h2_m.group(1))).strip()
                raw_url = re.sub(r'<[^>]+>', '', htmlmod.unescape(cite_m.group(1))).strip()
                # Clean up cite format "https://example.com › path"
                raw_url = re.sub(r' ›.*', '', raw_url)
                if not raw_url.startswith('http'):
                    raw_url = 'https://' + raw_url
                snippet = ''
                if snippet_m:
                    snippet = re.sub(r'<[^>]+>', '', htmlmod.unescape(snippet_m.group(1))).strip()
                results.append({"title": title, "url": raw_url, "snippet": snippet})

    except Exception as e:
        log(f"Bing search failed: {e}")
    return results

def do_web_search(query, max_results=10):
    # Try ddgs package (renamed from duckduckgo_search)
    try:
        from ddgs import DDGS
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=max_results))
            if results:
                return [{"title": r.get("title", ""), "url": r.get("href", ""), "snippet": r.get("body", "")} for r in results]
    except ImportError:
        # Fallback to old package name
        try:
            from duckduckgo_search import DDGS
            with DDGS() as ddgs:
                results = list(ddgs.text(query, max_results=max_results))
                if results:
                    return [{"title": r.get("title", ""), "url": r.get("href", ""), "snippet": r.get("body", "")} for r in results]
        except ImportError:
            log("ddgs/duckduckgo_search not available, using HTML fallback")
        except Exception as e:
            log(f"duckduckgo_search failed: {e}")
    except Exception as e:
        log(f"ddgs failed: {e}")

    # Fallback: DDG HTML
    results = ddg_html_search(query, max_results)
    if results:
        return results

    # Fallback: Bing
    return bing_search(query, max_results)

def do_web_fetch(url):
    if not url.startswith("http://") and not url.startswith("https://"):
        return {"error": "URL must start with http:// or https://"}
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
        })
        resp = urllib.request.urlopen(req, timeout=15, context=ctx)
        content_type = resp.headers.get("Content-Type", "")
        if "text/html" not in content_type and "text/" not in content_type:
            return {"content": f"[Binary content: {content_type}]", "url": url}
        raw = resp.read().decode("utf-8", errors="replace")
        text = re.sub(r'<script[^>]*>.*?</script>', '', raw, flags=re.DOTALL)
        text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL)
        text = re.sub(r'<[^>]+>', ' ', text)
        text = htmlmod.unescape(text)
        text = re.sub(r'\s+', ' ', text).strip()
        if len(text) > 8000:
            text = text[:8000] + "\n... [truncated]"
        return {"content": text, "url": url}
    except Exception as e:
        return {"error": str(e), "url": url}

def handle_tool_call(name, arguments):
    if name == "web_search":
        query = arguments.get("query", "")
        max_results = arguments.get("max_results", 10)
        results = do_web_search(query, max_results)
        return {"content": [{"type": "text", "text": json.dumps(results, indent=2)}]}
    elif name == "web_fetch":
        url = arguments.get("url", "")
        result = do_web_fetch(url)
        return {"content": [{"type": "text", "text": json.dumps(result, indent=2)}]}
    else:
        return {"content": [{"type": "text", "text": f"Unknown tool: {name}"}]}

def handle_message(line):
    line = line.strip()
    if not line:
        return
    try:
        msg = json.loads(line)
    except json.JSONDecodeError:
        send(jsonrpc_error(None, -32700, "Parse error"))
        return

    method = msg.get("method")
    msg_id = msg.get("id")
    params = msg.get("params", {})

    if method == "initialize":
        result = {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": "ddg-search", "version": "1.0.0"},
        }
        send(jsonrpc_response(msg_id, result))
    elif method == "notifications/initialized":
        pass
    elif method == "tools/list":
        send(jsonrpc_response(msg_id, {"tools": TOOLS}))
    elif method == "tools/call":
        tool_name = params.get("name", "")
        arguments = params.get("arguments", {})
        result = handle_tool_call(tool_name, arguments)
        send(jsonrpc_response(msg_id, result))
    elif method == "ping":
        send(jsonrpc_response(msg_id, {}))
    else:
        send(jsonrpc_error(msg_id, -32601, f"Method not found: {method}"))

def main():
    log("MCP DDG Search server starting")
    stdin_fd = sys.stdin.fileno()
    buf = b""
    alive = True

    while alive:
        # Wait for data on stdin (with timeout so we can check if stdin closed)
        try:
            ready, _, _ = select.select([stdin_fd], [], [], 0.5)
        except (ValueError, OSError):
            break

        if ready:
            chunk = os.read(stdin_fd, 65536)
            if not chunk:
                # stdin closed (EOF) — keep alive briefly for any pending I/O
                log("stdin EOF, waiting for pending responses...")
                time.sleep(1.0)
                break
            buf += chunk
            # Process complete lines
            while b"\n" in buf:
                line_bytes, buf = buf.split(b"\n", 1)
                handle_message(line_bytes.decode("utf-8", errors="replace"))

    log("MCP DDG Search server shutting down")

if __name__ == "__main__":
    main()
