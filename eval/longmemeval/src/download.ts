/**
 * Download the LongMemEval oracle split to data/.
 * Idempotent: skips if file already exists.
 */
import { existsSync, mkdirSync, statSync, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { resolve } from 'node:path'

const URL =
  'https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_oracle.json'
const OUT = resolve(import.meta.dirname ?? '.', '..', 'data', 'longmemeval_oracle.json')

async function main() {
  mkdirSync(resolve(OUT, '..'), { recursive: true })

  if (existsSync(OUT)) {
    const size = statSync(OUT).size
    console.log(`Already downloaded: ${OUT} (${size} bytes)`)
    return
  }

  console.log(`Downloading ${URL} → ${OUT}`)
  const res = await fetch(URL)
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  }
  await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(OUT))
  console.log(`Done. ${statSync(OUT).size} bytes.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
