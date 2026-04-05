import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getEncryptionKey, encryptValue, decryptValue } from '../crypto/encryption'

describe('encryption utilities', () => {
  const VALID_KEY_HEX = 'a'.repeat(64) // 32 bytes as 64 hex chars

  beforeEach(() => {
    delete process.env.TAGES_ENCRYPTION_KEY
  })

  afterEach(() => {
    delete process.env.TAGES_ENCRYPTION_KEY
  })

  describe('getEncryptionKey', () => {
    it('returns null when TAGES_ENCRYPTION_KEY is not set', () => {
      expect(getEncryptionKey()).toBeNull()
    })

    it('returns a Buffer when a valid 64-hex-char key is set', () => {
      process.env.TAGES_ENCRYPTION_KEY = VALID_KEY_HEX
      const key = getEncryptionKey()
      expect(key).toBeInstanceOf(Buffer)
      expect(key!.length).toBe(32)
    })

    it('throws when TAGES_ENCRYPTION_KEY is not 64 hex characters', () => {
      process.env.TAGES_ENCRYPTION_KEY = 'deadbeef' // too short
      expect(() => getEncryptionKey()).toThrow(
        'TAGES_ENCRYPTION_KEY must be 64 hex characters (32 bytes)'
      )
    })

    it('throws when TAGES_ENCRYPTION_KEY is too long', () => {
      process.env.TAGES_ENCRYPTION_KEY = 'a'.repeat(66)
      expect(() => getEncryptionKey()).toThrow(
        'TAGES_ENCRYPTION_KEY must be 64 hex characters (32 bytes)'
      )
    })
  })

  describe('encryptValue / decryptValue round-trip', () => {
    it('decrypts to the original plaintext', () => {
      process.env.TAGES_ENCRYPTION_KEY = VALID_KEY_HEX
      const key = getEncryptionKey()!
      const plaintext = 'super secret value'
      const ciphertext = encryptValue(plaintext, key)
      expect(ciphertext.startsWith('enc:v1:')).toBe(true)
      expect(decryptValue(ciphertext, key)).toBe(plaintext)
    })

    it('produces different ciphertexts for the same plaintext (random IV)', () => {
      process.env.TAGES_ENCRYPTION_KEY = VALID_KEY_HEX
      const key = getEncryptionKey()!
      const plaintext = 'hello'
      const c1 = encryptValue(plaintext, key)
      const c2 = encryptValue(plaintext, key)
      expect(c1).not.toBe(c2)
    })

    it('round-trips an empty string', () => {
      process.env.TAGES_ENCRYPTION_KEY = VALID_KEY_HEX
      const key = getEncryptionKey()!
      expect(decryptValue(encryptValue('', key), key)).toBe('')
    })

    it('round-trips a unicode string', () => {
      process.env.TAGES_ENCRYPTION_KEY = VALID_KEY_HEX
      const key = getEncryptionKey()!
      const plaintext = 'こんにちは 🌍'
      expect(decryptValue(encryptValue(plaintext, key), key)).toBe(plaintext)
    })
  })

  describe('decryptValue backward compatibility', () => {
    it('returns a non-prefixed string unchanged', () => {
      process.env.TAGES_ENCRYPTION_KEY = VALID_KEY_HEX
      const key = getEncryptionKey()!
      const plain = 'plain text without prefix'
      expect(decryptValue(plain, key)).toBe(plain)
    })

    it('returns an empty string unchanged', () => {
      process.env.TAGES_ENCRYPTION_KEY = VALID_KEY_HEX
      const key = getEncryptionKey()!
      expect(decryptValue('', key)).toBe('')
    })
  })
})
