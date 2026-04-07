import { spawn, ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

export class McpTestClient {
  private process!: ChildProcess
  private buffer: string = ''
  private pending = new Map<number, { resolve: (r: any) => void; reject: (e: Error) => void }>()
  private msgId: number = 1
  private tmpHome: string

  constructor(private dbPath: string) {
    this.tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-test-home-'))
  }

  async start(): Promise<void> {
    // Use the worktree root as cwd so module resolution works
    const cwd = path.resolve(__dirname, '../../../../..')

    // Find tsx binary — check standard locations relative to project root
    const tsxCandidates = [
      path.join(cwd, 'packages/server/node_modules/.bin/tsx'),
      path.join(cwd, 'node_modules/.bin/tsx'),
      path.join(cwd, 'node_modules/.pnpm/node_modules/.bin/tsx'),
    ]
    const tsxBin = tsxCandidates.find(p => fs.existsSync(p)) ?? 'tsx'

    this.process = spawn(tsxBin, ['packages/server/src/index.ts'], {
      cwd,
      env: { ...process.env, TAGES_CACHE_PATH: this.dbPath, HOME: this.tmpHome },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.process.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString()
      const lines = this.buffer.split('\n')
      this.buffer = lines.pop()!
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line)
          if (msg.id != null && this.pending.has(msg.id)) {
            const { resolve } = this.pending.get(msg.id)!
            this.pending.delete(msg.id)
            resolve(msg)
          }
        } catch {
          // ignore non-JSON lines
        }
      }
    })

    // Wait for server ready signal on stderr before sending initialize
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Server failed to start within 20 seconds'))
      }, 20000)

      let stderrBuf = ''
      this.process.stderr!.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString()
        if (stderrBuf.includes('Server ready')) {
          clearTimeout(timer)
          resolve()
        }
      })

      this.process.on('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`Server exited early with code ${code}`))
      })

      this.process.on('error', (err) => {
        clearTimeout(timer)
        reject(new Error(`Server process error: ${err.message}`))
      })
    })

    const initId = this.msgId++
    const initResponse = await this.sendRequest(initId, {
      jsonrpc: '2.0',
      id: initId,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      },
    })

    if (initResponse.error) {
      throw new Error(`Initialize failed: ${JSON.stringify(initResponse.error)}`)
    }

    // Send initialized notification (no id, no response expected)
    this.write({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    const id = this.msgId++
    const response = await this.sendRequest(
      id,
      {
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name, arguments: args },
      },
      10000,
      name,
    )

    if (response.error) {
      throw new Error(`Tool call failed (${name}): ${JSON.stringify(response.error)}`)
    }

    return response.result
  }

  async stop(): Promise<void> {
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        this.process.on('exit', () => resolve())
        setTimeout(() => {
          if (!this.process.killed) this.process.kill('SIGKILL')
          resolve()
        }, 5000)
      })
    }

    // Clean up pending promises
    for (const [, { reject }] of this.pending) {
      reject(new Error('Client stopped'))
    }
    this.pending.clear()

    // Delete temp db
    try {
      if (fs.existsSync(this.dbPath)) fs.unlinkSync(this.dbPath)
    } catch {
      // ignore cleanup errors
    }

    // Delete temp home dir
    try {
      if (fs.existsSync(this.tmpHome)) fs.rmSync(this.tmpHome, { recursive: true })
    } catch {
      // ignore cleanup errors
    }
  }

  private write(msg: Record<string, unknown>): void {
    this.process.stdin!.write(JSON.stringify(msg) + '\n')
  }

  private sendRequest(
    id: number,
    msg: Record<string, unknown>,
    timeout: number = 30000,
    label?: string,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Tool call timed out: ${label ?? `id=${id}`}`))
      }, timeout)

      this.pending.set(id, {
        resolve: (r: any) => {
          clearTimeout(timer)
          resolve(r)
        },
        reject: (e: Error) => {
          clearTimeout(timer)
          reject(e)
        },
      })

      this.write(msg)
    })
  }
}
