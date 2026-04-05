import { describe, it, expect } from 'vitest'
import { scanForSensitiveData } from '../tools/safety'

describe('scanForSensitiveData', () => {
  describe('secrets', () => {
    it('detects GitHub tokens', () => {
      const warnings = scanForSensitiveData('token: ghp_1234567890abcdefghijklmnopqrstuvwxyz1234')
      expect(warnings.some(w => w.name === 'GitHub token')).toBe(true)
      expect(warnings[0].severity).toBe('high')
    })

    it('detects Stripe keys', () => {
      const warnings = scanForSensitiveData('sk_live_1234567890abcdefghijklmn')
      expect(warnings.some(w => w.name === 'Stripe key')).toBe(true)
    })

    it('detects OpenAI keys', () => {
      const warnings = scanForSensitiveData('sk-abcdefghijklmnopqrstuvwxyz')
      expect(warnings.some(w => w.name === 'OpenAI key')).toBe(true)
    })

    it('detects Bearer tokens', () => {
      const warnings = scanForSensitiveData('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxx')
      expect(warnings.some(w => w.name === 'Bearer token')).toBe(true)
    })

    it('detects password fields', () => {
      const warnings = scanForSensitiveData('password=my_secret_password')
      expect(warnings.some(w => w.name === 'Password field')).toBe(true)
    })

    it('detects connection strings', () => {
      const warnings = scanForSensitiveData('postgres://user:pass@host:5432/db')
      expect(warnings.some(w => w.name === 'Connection string')).toBe(true)
    })

    it('detects private keys', () => {
      const warnings = scanForSensitiveData('-----BEGIN RSA PRIVATE KEY-----')
      expect(warnings.some(w => w.name === 'Private key')).toBe(true)
    })
  })

  describe('PII', () => {
    it('detects email addresses', () => {
      const warnings = scanForSensitiveData('contact us at user@example.com for support')
      expect(warnings.some(w => w.name === 'Email address')).toBe(true)
      expect(warnings.find(w => w.name === 'Email address')!.severity).toBe('medium')
    })

    it('detects SSN patterns', () => {
      const warnings = scanForSensitiveData('SSN: 123-45-6789')
      expect(warnings.some(w => w.name === 'SSN')).toBe(true)
    })
  })

  describe('clean text', () => {
    it('returns no warnings for safe content', () => {
      const warnings = scanForSensitiveData('Use snake_case for all API route names. Always return { error, code, status } from error handlers.')
      expect(warnings.length).toBe(0)
    })

    it('returns no warnings for code patterns', () => {
      const warnings = scanForSensitiveData('The auth middleware checks JWT tokens from httpOnly cookies.')
      expect(warnings.length).toBe(0)
    })
  })
})
