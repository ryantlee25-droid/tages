// Where the suite gets its keys, in order of preference.
//
// The service_role key is the most dangerous secret in this project: it
// bypasses RLS on every table. This repo has already had to rotate one because
// it was exported from ~/.zshrc, which put it in every shell, every child
// process, and every terminal transcript.
//
// Resolution order:
//
//   1. macOS Keychain — preferred. The value is never in a file, never in argv,
//      never in shell history, and never in the environment of unrelated
//      processes. Only this suite reads it, only while it runs.
//   2. Environment variable — for CI, where a secrets store already scopes the
//      value to one job.
//
// The anon key is deliberately treated as public: it is embedded in every
// .mcp.json this product writes, and phase 04 asserts that file is git-ignored
// precisely because the project id travels with it. Storing the anon key in the
// Keychain is supported but not required.

import { execFileSync } from 'child_process'
import * as readline from 'readline'

const SERVICE = 'tages-e2e'

// macOS `security -w` with no value prompts via readpassphrase(3), whose buffer
// is _PASSWORD_LEN = 128 bytes. Anything longer is truncated SILENTLY: exit 0,
// no warning, a stored value that looks plausible and is unusable. A Supabase
// JWT is ~200-250 characters, so the documented "safe" way to store one this
// way cannot work. Measured, not inferred: a 220-char value stored through the
// prompt reads back as 128 chars.
//
// Hence `--set-credentials`: node's TTY reader has no such limit, and every
// write is read straight back and compared byte for byte before it is trusted.
const READPASSPHRASE_LIMIT = 128

/** Read one item from the login keychain. Returns null when absent. */
function fromKeychain(account) {
  try {
    return execFileSync('security', ['find-generic-password', '-a', account, '-s', SERVICE, '-w'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000,
    }).trim()
  } catch {
    return null
  }
}

const SETUP = `
Store the keys once:

  node e2e/run.mjs --set-credentials

It prompts for each key with echo off, checks the shape, writes it to the macOS
Keychain, and reads it straight back to prove nothing was truncated.

Do NOT use \`security add-generic-password ... -w\` with an interactive prompt.
Its input buffer is ${READPASSPHRASE_LIMIT} bytes and it truncates a Supabase JWT
silently, with exit code 0.

Get the values from the Supabase dashboard, Settings -> API:
  service_role  secret — bypasses RLS on every table
  anon / public already public; shipped in every .mcp.json this product writes

To rotate, re-run --set-credentials. To remove:

  security delete-generic-password -a service-key -s ${SERVICE}
  security delete-generic-password -a anon-key    -s ${SERVICE}

CI instead uses TAGES_E2E_SERVICE_KEY and TAGES_E2E_ANON_KEY from the job's
secret store.
`

/** Read one line from the TTY with echo off. No length limit, unlike readpassphrase. */
function promptHidden(label) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('--set-credentials needs an interactive terminal; run it yourself, not through a tool.'))
      return
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    // Suppress echo by swallowing everything readline would write after the
    // prompt itself, so a pasted key never appears on screen or in scrollback.
    let shown = false
    const write = rl._writeToOutput.bind(rl)
    rl._writeToOutput = s => {
      if (!shown) {
        write(s)
        shown = true
      }
    }
    rl.question(label, answer => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer.trim())
    })
  })
}

/** Structural report on a key. Returns findings, never the value. */
export function describeKey(value, expected) {
  const segments = value.split('.')
  const out = { length: value.length, segments: segments.length, role: null, ref: null, problems: [] }

  if (value.length === READPASSPHRASE_LIMIT) {
    out.problems.push(
      `exactly ${READPASSPHRASE_LIMIT} characters — the signature of a value truncated by the \`security -w\` prompt`,
    )
  }
  if (/^eyJ/.test(value)) {
    if (segments.length !== 3) {
      out.problems.push(`a JWT has 3 dot-separated segments; this has ${segments.length}, so it is incomplete`)
    } else {
      try {
        const pad = segments[1] + '='.repeat((-segments[1].length % 4 + 4) % 4)
        const claims = JSON.parse(Buffer.from(pad, 'base64url').toString('utf-8'))
        out.role = claims.role ?? null
        out.ref = claims.ref ?? null
      } catch {
        out.problems.push('the JWT payload could not be decoded')
      }
    }
  } else if (!/^sb_(secret|publishable)_/.test(value)) {
    out.problems.push('does not look like a Supabase key (expected an eyJ… JWT or sb_secret_… / sb_publishable_…)')
  }

  if (expected === 'service' && (out.role === 'anon' || /^sb_publishable_/.test(value))) {
    out.problems.push('this is the ANON key, not service_role — fixture users cannot be created with it')
  }
  if (expected === 'anon' && (out.role === 'service_role' || /^sb_secret_/.test(value))) {
    out.problems.push('this is the SERVICE_ROLE key — storing it as the anon key would bypass RLS in every check')
  }
  return out
}

/**
 * Prompt for both keys, store them, and verify the round trip.
 *
 * The value reaches `security` as an argument, which is briefly visible in this
 * user's own `ps` output. That is the only channel the macOS CLI offers for a
 * value over 128 bytes, and it is a sub-second window on a process nobody else
 * can read argv from — as against a dotfile, which is a permanent exposure to
 * every process running as you, plus every backup.
 */
export async function setCredentials() {
  console.log(
    '\nStoring Tages E2E credentials in the macOS Keychain.\n' +
      'Input is hidden. Paste each value and press Enter.\n' +
      'Supabase dashboard -> Settings -> API.\n',
  )

  const results = []
  for (const [account, expected, label] of [
    ['service-key', 'service', 'service_role key (secret): '],
    ['anon-key', 'anon', 'anon / public key: '],
  ]) {
    const value = await promptHidden(label)
    if (!value) {
      console.error(`  refused: empty value for ${account}`)
      return 2
    }

    const shape = describeKey(value, expected)
    if (shape.problems.length) {
      console.error(`  refused: ${account}`)
      for (const p of shape.problems) console.error(`    - ${p}`)
      console.error('  nothing was stored. Re-run when you have the full value.')
      return 2
    }

    execFileSync('security', ['add-generic-password', '-U', '-a', account, '-s', SERVICE, '-w', value], {
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 15000,
    })

    // The whole reason this command exists. A write that is not read back is a
    // hope, and the failure mode being guarded against is a silent truncation
    // that leaves a plausible-looking, unusable value in place.
    const stored = fromKeychain(account)
    if (stored !== value) {
      console.error(
        `  FAILED: ${account} read back as ${stored === null ? 'missing' : `${stored.length} chars, expected ${value.length}`}.`,
      )
      console.error('  the Keychain did not store what was entered. Do not proceed.')
      return 1
    }

    results.push({ account, ...shape })
    console.log(
      `  stored ${account}: ${shape.length} chars` +
        `${shape.role ? `, role=${shape.role}` : ''}${shape.ref ? `, project ref=${shape.ref}` : ''}` +
        ', read back byte-identical',
    )
  }

  const refs = [...new Set(results.map(r => r.ref).filter(Boolean))]
  if (refs.length > 1) {
    console.error(`\n  warning: the two keys belong to different Supabase projects (${refs.join(', ')}).`)
    return 1
  }
  console.log(`\nBoth keys stored${refs[0] ? ` for project ${refs[0]}` : ''}. Run: pnpm test:e2e\n`)
  return 0
}

/** Report what is stored, by shape only. Never returns or prints a value. */
export function checkCredentials() {
  let bad = 0
  for (const [account, expected] of [
    ['service-key', 'service'],
    ['anon-key', 'anon'],
  ]) {
    const value = process.env[account === 'service-key' ? 'TAGES_E2E_SERVICE_KEY' : 'TAGES_E2E_ANON_KEY'] || fromKeychain(account)
    if (!value) {
      console.log(`  ${account}: MISSING`)
      bad++
      continue
    }
    const shape = describeKey(value, expected)
    const summary =
      `${shape.length} chars, ${shape.segments} segment(s)` +
      `${shape.role ? `, role=${shape.role}` : ''}${shape.ref ? `, ref=${shape.ref}` : ''}`
    if (shape.problems.length) {
      console.log(`  ${account}: PROBLEM — ${summary}`)
      for (const p of shape.problems) console.log(`      - ${p}`)
      bad++
    } else {
      console.log(`  ${account}: ok — ${summary}`)
    }
  }
  return bad === 0 ? 0 : 1
}

/**
 * @returns {{serviceKey: string, anonKey: string, source: {service: string, anon: string}}}
 * @throws when either key cannot be resolved, with setup instructions.
 */
export function resolveCredentials() {
  const envService = process.env.TAGES_E2E_SERVICE_KEY
  const envAnon = process.env.TAGES_E2E_ANON_KEY

  const serviceKey = envService || fromKeychain('service-key')
  const anonKey = envAnon || fromKeychain('anon-key')

  const missing = []
  if (!serviceKey) missing.push('service_role key')
  if (!anonKey) missing.push('anon key')
  if (missing.length) {
    throw new Error(`cannot resolve the ${missing.join(' and ')}.\n${SETUP}`)
  }

  // Refuse a truncated or swapped key here rather than letting it surface as an
  // opaque 401 halfway through fixture creation, after users and a project have
  // already been made.
  for (const [label, value, expected] of [
    ['service_role key', serviceKey, 'service'],
    ['anon key', anonKey, 'anon'],
  ]) {
    const shape = describeKey(value, expected)
    if (shape.problems.length) {
      throw new Error(
        `the stored ${label} is not usable:\n` +
          shape.problems.map(p => `  - ${p}`).join('\n') +
          `\n\nRe-store it with:  node e2e/run.mjs --set-credentials\n`,
      )
    }
  }

  return {
    serviceKey,
    anonKey,
    source: {
      service: envService ? 'environment' : 'macOS Keychain',
      anon: envAnon ? 'environment' : 'macOS Keychain',
    },
  }
}

export const SETUP_INSTRUCTIONS = SETUP
