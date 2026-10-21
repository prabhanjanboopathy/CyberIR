import 'dotenv/config'
import mongoose from 'mongoose'
import { seedDemoData } from './seedDemo.js'

if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required')
await mongoose.connect(process.env.MONGODB_URI)
const { organization, users } = await seedDemoData({ password: process.env.DEMO_PASSWORD, orgSlug: process.env.DEMO_ORG_SLUG })
console.log(`Seeded ${users.length} demo accounts for ${organization.name} (${organization.slug}); sign in with DEMO_PASSWORD from apps/api/.env`)
console.log(users.map(({ email }) => email).join('\n'))
await mongoose.disconnect()
