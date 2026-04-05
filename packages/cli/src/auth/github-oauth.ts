import * as http from 'http'
import open from 'open'

/**
 * Runs the GitHub OAuth flow for CLI authentication.
 * Opens the browser to the dashboard's /auth/cli route, which redirects
 * back with a session token after GitHub OAuth.
 */
export async function runGithubOAuth(dashboardUrl: string): Promise<{
  accessToken: string
  refreshToken: string
  userId: string
}> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '', `http://localhost`)
      const accessToken = url.searchParams.get('access_token')
      const refreshToken = url.searchParams.get('refresh_token')
      const userId = url.searchParams.get('user_id')
      const error = url.searchParams.get('error')

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body><h1>Authentication failed</h1><p>You can close this window.</p></body></html>')
        server.close()
        reject(new Error(`OAuth error: ${error}`))
        return
      }

      if (accessToken && refreshToken && userId) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body><h1>Authenticated!</h1><p>You can close this window and return to the terminal.</p></body></html>')
        server.close()
        resolve({ accessToken, refreshToken, userId })
        return
      }

      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('Missing auth parameters')
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to start local auth server'))
        return
      }

      const callbackUrl = `http://127.0.0.1:${addr.port}/callback`
      const authUrl = `${dashboardUrl}/auth/cli?redirect_uri=${encodeURIComponent(callbackUrl)}`
      open(authUrl)
    })

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close()
      reject(new Error('OAuth flow timed out after 5 minutes'))
    }, 5 * 60 * 1000)
  })
}
