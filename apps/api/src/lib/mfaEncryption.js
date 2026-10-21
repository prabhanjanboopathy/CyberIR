import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

function encryptionKey() {
  const value = process.env.MFA_ENCRYPTION_KEY
  if (!value) throw new Error('MFA_ENCRYPTION_KEY is required for MFA secrets')
  const key = Buffer.from(value, 'base64')
  if (key.length !== 32) throw new Error('MFA_ENCRYPTION_KEY must decode to 32 bytes')
  return key
}

export function encryptMfaSecret(secret) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.')
}

export function decryptMfaSecret(value) {
  if (!value) throw new Error('No MFA secret is enrolled')
  const [ivValue, tagValue, ciphertextValue] = value.split('.')
  if (!ivValue || !tagValue || !ciphertextValue) throw new Error('Encrypted MFA secret is malformed')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64url')), decipher.final()]).toString('utf8')
}
