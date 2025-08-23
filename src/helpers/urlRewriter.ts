// URL rewriter used by comments/replies image rendering.
// Purpose: "disable SSL for images" by forcing https -> http (and wss -> ws).
// This helps avoid SSL CN errors and cert issues on certain image hosts.

// URL rewriting function to avoid SSL CN errors
export function urlRewriter(url: string): string {
  // If no URL provided, return as-is
  if (!url)
    return url

  try {
    // Protocol-relative (//host/path) -> force http
    if (url.startsWith('//'))
      return `http:${url.slice(0)}`

    // Already non-SSL or data/blob URIs -> leave as-is
    if (url.startsWith('http://') || url.startsWith('ws://') || url.startsWith('data:') || url.startsWith('blob:'))
      return url

    // Simple fast-path replacements
    if (url.startsWith('https://'))
      return `http://${url.slice('https://'.length)}`
    if (url.startsWith('wss://'))
      return `ws://${url.slice('wss://'.length)}`

    // Fallback: try URL parser and downgrade protocol
    const u = new URL(url)
    if (u.protocol === 'https:')
      u.protocol = 'http:'
    else if (u.protocol === 'wss:')
      u.protocol = 'ws:'
    return u.toString()
  }
  catch (e) {
    // If any error occurs, try a minimal https->http replace and return
    try {
      return url.replace(/^https:\/\//, 'http://').replace(/^wss:\/\//, 'ws://')
    }
    catch {
      // Last resort: original URL
      console.warn('URL rewriting failed, using original URL:', url, e)
      return url
    }
  }
}

// Function to check if a URL should be rewritten
export function shouldRewriteUrl(url: string): boolean {
  if (!url)
    return false
  // We only need to rewrite when the scheme is secure or protocol-relative
  return url.startsWith('https://') || url.startsWith('wss://') || url.startsWith('//')
}
