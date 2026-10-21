import test from 'node:test'
import assert from 'node:assert/strict'
import { decryptMfaSecret, encryptMfaSecret } from '../src/lib/mfaEncryption.js'

process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')

test('MFA secret encryption authenticates and round-trips data', () => {
  const secret = 'JBSWY3DPEHPK3PXP'
  const encrypted = encryptMfaSecret(secret)
  assert.notEqual(encrypted, secret)
  assert.equal(decryptMfaSecret(encrypted), secret)
  const parts = encrypted.split('.')
  const ciphertext = Buffer.from(parts[2], 'base64url')
  ciphertext[0] ^= 1
  parts[2] = ciphertext.toString('base64url')
  assert.throws(() => decryptMfaSecret(parts.join('.')))
})
