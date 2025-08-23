// URL rewriter to avoid SSL Common Name errors for external images
// Based on pocketnet.gui's urlextended function

// Mock server list - in a real implementation, this would be populated from an API
const servers: { host: string, ip: string }[] = [
  // Example entries - would be populated dynamically in real implementation
  // { host: 'example.peertube.server', ip: '192.168.1.100' },
  // { host: 'another.peertube.server', ip: '192.168.1.101' }
]

// Simple server lookup function
function getServer(hostip: string) {
  return servers.find(s => s.host === hostip || s.ip === hostip)
}

// URL rewriting function to avoid SSL CN errors
export function urlRewriter(url: string): string {
  // If no URL provided, return as-is
  if (!url)
    return url

  try {
    // Split URL into protocol and rest
    const parts = url.split('://')
    let oldProtocol = 'http'
    let protocol = ''
    let secure = true

    if (parts.length > 1) {
      oldProtocol = parts[0]
      parts.shift()

      secure = oldProtocol === 'https' || oldProtocol === 'wss'

      if (oldProtocol === 'https')
        oldProtocol = 'http'
      if (oldProtocol === 'wss')
        oldProtocol = 'ws'
      if (oldProtocol === '.')
        oldProtocol = ''
    }

    const rest = parts.join('')
    const restParts = rest.split('/')

    const hostip = restParts[0]
    restParts.shift()

    const path = restParts.join('/')
    const server = getServer(hostip)

    protocol = oldProtocol

    const formattedPath = path ? `/${path}` : ''

    // If no server found, return original URL
    if (!server) {
      if (!hostip.includes('.'))
        return url

      if (secure)
        protocol = `${protocol}s`
      return `${protocol}://${hostip}${formattedPath}`
    }

    // Use IP instead of hostname to avoid SSL CN errors
    // In a real implementation, we might check a setting like app.useip()
    const useIp = true // Always use IP to avoid SSL issues
    if (useIp)
      secure = false

    if (secure)
      protocol = `${protocol}s`

    const finalHost = useIp ? server.ip : server.host

    return `${protocol}://${finalHost}${formattedPath}`
  }
  catch (e) {
    // If any error occurs, return original URL
    console.warn('URL rewriting failed, using original URL:', url, e)
    return url
  }
}

// Function to check if a URL should be rewritten
export function shouldRewriteUrl(url: string): boolean {
  if (!url)
    return false

  // Only rewrite HTTPS URLs that might have SSL CN issues
  return url.startsWith('https://')
}
