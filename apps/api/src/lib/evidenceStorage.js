import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { ApiError } from './errors.js'

const bucket = process.env.S3_BUCKET
const region = process.env.S3_REGION ?? 'us-east-1'
const root = resolve(process.env.EVIDENCE_LOCAL_DIR ?? 'var/evidence')
const endpoint = process.env.S3_ENDPOINT
const s3 = bucket ? new S3Client({
  region,
  ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } }
    : {}),
}) : null

function localPath(key) {
  const resolved = resolve(root, key)
  if (!resolved.startsWith(`${root}${sep}`)) throw new ApiError(400, 'INVALID_OBJECT_KEY', 'Evidence object key is invalid')
  return resolved
}

export function evidenceStorageProvider() {
  if (s3) return 's3'
  if (process.env.NODE_ENV === 'production') throw new ApiError(503, 'STORAGE_NOT_CONFIGURED', 'Private S3-compatible evidence storage is required in production')
  return 'local'
}

export async function storeEvidence({ key, buffer, contentType, sha256 }) {
  const provider = evidenceStorageProvider()
  if (provider === 's3') {
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentLength: buffer.length,
      ContentType: contentType,
      ContentDisposition: 'attachment',
      ServerSideEncryption: process.env.S3_KMS_KEY_ID ? 'aws:kms' : 'AES256',
      ...(process.env.S3_KMS_KEY_ID ? { SSEKMSKeyId: process.env.S3_KMS_KEY_ID } : {}),
      Metadata: { sha256 },
    }))
  } else {
    const target = localPath(key)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, buffer, { flag: 'wx', mode: 0o600 })
  }
  return provider
}

export async function readEvidence({ key, provider }) {
  if (provider === 's3') {
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    return Buffer.from(await response.Body.transformToByteArray())
  }
  return readFile(localPath(key))
}

export async function removeEvidence({ key, provider }) {
  if (provider === 's3') {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    return
  }
  await rm(localPath(key), { force: true })
}
