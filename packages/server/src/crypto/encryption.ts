import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const PREFIX = 'enc:v1:'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

export function getEncryptionKey(): Buffer | null {
  const hex = process.env.TAGES_ENCRYPTION_KEY
  if (!hex) return null
  const buf = Buffer.from(hex, 'hex')
  if (buf.length !== 32) {
    throw new Error('TAGES_ENCRYPTION_KEY must be 64 hex characters (32 bytes)')
  }
  return buf
}

export function encryptValue(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  const combined = Buffer.concat([iv, authTag, encrypted])
  return PREFIX + combined.toString('base64')
}

export function decryptValue(ciphertext: string, key: Buffer): string {
  // Backward compat: non-prefixed values are returned as-is
  if (!ciphertext.startsWith(PREFIX)) return ciphertext
  const data = Buffer.from(ciphertext.slice(PREFIX.length), 'base64')
  const iv = data.subarray(0, IV_LENGTH)
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return decipher.update(encrypted) + decipher.final('utf8')
}
