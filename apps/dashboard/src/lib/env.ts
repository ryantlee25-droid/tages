/**
 * Startup environment variable validation.
 * Call validateEnv() once at server startup (e.g. in layout.tsx at module scope).
 * Missing required vars throw immediately so the app fails fast with a clear message.
 * Missing optional vars (e.g. Stripe) emit a console.warn only.
 */

const REQUIRED_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const

const OPTIONAL_VARS: Array<{ name: string; hint: string }> = [
  {
    name: 'STRIPE_SECRET_KEY',
    hint: 'Stripe billing features will be unavailable.',
  },
]

export function validateEnv(): void {
  for (const name of REQUIRED_VARS) {
    const value = process.env[name]
    if (!value || value.trim() === '') {
      throw new Error(`Missing required environment variable: ${name}`)
    }
  }

  for (const { name, hint } of OPTIONAL_VARS) {
    const value = process.env[name]
    if (!value || value.trim() === '') {
      console.warn(
        `[tages] Optional environment variable not set: ${name}. ${hint}`,
      )
    }
  }
}
