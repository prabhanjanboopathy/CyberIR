import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const apiRequire = createRequire(join(root, 'apps', 'api', 'package.json'))
apiRequire('dotenv').config({ path: join(root, 'apps', 'api', '.env') })
const mongoose = apiRequire('mongoose')

const uri = process.env.MONGODB_URI
if (!uri) {
  console.error('MONGODB_URI is not set. Run `npm run setup` and check apps/api/.env.')
  process.exit(1)
}

let temporaryCollection
let session
try {
  console.log('Connecting to configured MongoDB endpoint…')
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 })
  const database = mongoose.connection.db
  console.log(`Connected to database ${database.databaseName}; checking replica-set metadata…`)
  const hello = await database.admin().command({ hello: 1 })
  if (!hello.setName) throw new Error('The configured MongoDB server is not running as a replica set.')

  temporaryCollection = `_sentinel_compass_check_${process.pid}`
  await database.createCollection(temporaryCollection)
  session = await mongoose.startSession()
  await session.withTransaction(async () => {
    await database.collection(temporaryCollection).insertOne({ check: 'ok' }, { session })
    await database.collection(temporaryCollection).updateOne({ check: 'ok' }, { $set: { transaction: 'ok' } }, { session })
  })

  const result = await database.collection(temporaryCollection).findOne({ check: 'ok' })
  if (result?.transaction !== 'ok') throw new Error('MongoDB transaction verification failed.')

  console.log(`MongoDB connection: OK (${database.databaseName})`)
  console.log(`Replica set: ${hello.setName}`)
  console.log('Transaction support: OK')
  if (/^mongodb:\/\/(127\.0\.0\.1|localhost):27017/.test(uri)) {
    console.log('MongoDB Compass URI: mongodb://127.0.0.1:27017/sentinel?directConnection=true')
  }
} catch (error) {
  console.error(`MongoDB check failed: ${error.message}`)
  process.exitCode = 1
} finally {
  await session?.endSession()
  if (temporaryCollection && mongoose.connection.readyState === 1) {
    await mongoose.connection.db.dropCollection(temporaryCollection).catch(() => undefined)
  }
  await mongoose.disconnect().catch(() => undefined)
}
