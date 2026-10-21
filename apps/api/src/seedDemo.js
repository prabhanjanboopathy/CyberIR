import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { DEFAULT_MAX_ACTIVE_CASES, LEVELS } from './constants.js'
import { CustodyEvent, Evidence, Organization, Report, User } from './models.js'
import { createReport } from './services/reports.js'
import { recountActiveCases } from './services/assignment.js'

const DEMO_USERS = [
  ['Maya Chen', 'reporter1@northstar.test', 0],
  ['Liam Brooks', 'reporter2@northstar.test', 0],
  ['Sofia Alvarez', 'reporter3@northstar.test', 0],
  ['Marcus Hale', 'engineer.malware@northstar.test', 1, ['Malware', 'Trojan Horse']],
  ['Tara Novak', 'engineer.trojan@northstar.test', 1, ['Trojan Horse', 'Malware']],
  ['Priya Raman', 'engineer.phishing@northstar.test', 1, ['Phishing/Social Engineering', 'Ransomware']],
  ['Noah Williams', 'engineer.ransomware@northstar.test', 1, ['Ransomware', 'Malware']],
  ['Elena Petrova', 'engineer.network@northstar.test', 1, ['DDoS/Network Intrusion', 'Phishing/Social Engineering']],
  ['Olivia Rhys', 'analyst@northstar.test', 2],
  ['Workspace Admin', 'admin@northstar.test', 3],
]

const LEGACY_EMAILS = ['manager', 'forensics', 'reporter', 'auditor'].map((name) => `${name}@northstar.test`)
const LEGACY_COLLECTIONS = ['incidents', 'comments', 'playbooks', 'tasks', 'slapolicies', 'notifications']

const SAMPLE_REPORTS = [
  ['Suspicious invoice attachment opened', 'Phishing', 'FIN-WS-044', 4, 5, 4, 0, 'In Progress', 2],
  ['Endpoint malware quarantine alert', 'Malware', 'ENG-LT-128', 3, 3, 3, 1, 'Under Assessment', 3],
  ['Fake banking app found on staff phones', 'Trojan Horse', 'MOBILE-FLEET', 4, 3, 3, 2, 'Yet to Assess', 1],
  ['File shares encrypted with ransom note', 'Ransomware', 'FILE-SRV-02', 5, 5, 5, 0, 'In Progress', 1],
  ['Customer portal flooded with traffic', 'DDoS', 'WEB-PORTAL', 4, 5, 4, 1, 'Under Surveillance', 4],
  ['Repeated unauthorised logins on VPN', 'Network Intrusion', 'VPN-GW-01', 3, 4, 4, 2, 'In Progress', 5],
  ['Employee copying client lists to USB', 'Insider Threat', 'CRM-EXPORT', 3, 2, 3, 0, 'Under Assessment', 6],
  ['Public storage bucket exposure', 'Data Breach', 'S3-CUSTOMER-EXPORT', 4, 4, 5, 1, 'Completed', 9],
  ['Credential-harvesting page imitating SSO', 'Phishing', 'IDP-TENANT', 3, 3, 4, 2, 'Closed', 12],
  ['Unknown USB device found in lobby', 'Other', 'LOBBY-KIOSK', 1, 2, 1, 0, 'Yet to Assess', 0],
]

async function removeLegacyData() {
  await User.deleteMany({ email: { $in: LEGACY_EMAILS } })
  await Promise.all([Evidence, CustodyEvent].map((model) => model.deleteMany({ reportId: { $exists: false } })))
  const existing = new Set((await mongoose.connection.db.listCollections().toArray()).map(({ name }) => name))
  await Promise.all(LEGACY_COLLECTIONS.filter((name) => existing.has(name)).map((name) => mongoose.connection.db.dropCollection(name)))
}

async function upsertUsers(organization, passwordHash) {
  const users = []
  for (const [name, email, level, specialties] of DEMO_USERS) {
    users.push(await User.findOneAndUpdate(
      { email },
      {
        $set: { name, level, title: LEVELS[level], orgId: organization._id, isActive: true, ...(specialties && { specialties }) },
        $setOnInsert: {
          passwordHash,
          ...(level === 1 && { availability: 'available', activeCaseCount: 0, maxActiveCases: DEFAULT_MAX_ACTIVE_CASES }),
        },
        $unset: { role: '', active: '' },
      },
      { upsert: true, new: true, strict: false },
    ))
  }
  return users
}

async function seedReports(organization, reporters) {
  const day = 24 * 60 * 60 * 1000
  for (const [title, attackType, affectedAsset, impact, urgency, assetCriticality, reporter, status, ageDays] of SAMPLE_REPORTS) {
    const report = await createReport({
      orgId: organization._id,
      reporterId: reporters[reporter]._id,
      input: { title, description: `${title}. Seeded sample report for local development and workflow testing.`, attackType, affectedAsset, impact, urgency, assetCriticality },
      createdAt: new Date(Date.now() - ageDays * day),
    })
    report.status = status
    report.progress = { 'Yet to Assess': 0, 'Under Assessment': 20, 'Under Surveillance': 60, 'In Progress': 50, Completed: 100, Closed: 100 }[status]
    if (['Completed', 'Closed'].includes(status)) report.closedAt = new Date()
    await report.save()
  }
}

export async function seedDemoData({ password, orgSlug = 'northstar' }) {
  if (!password || password.length < 12) throw new Error('DEMO_PASSWORD must contain at least 12 characters')

  const organization = await Organization.findOneAndUpdate(
    { slug: orgSlug },
    { $setOnInsert: { name: 'Northstar Group', slug: orgSlug } },
    { upsert: true, new: true },
  )
  await removeLegacyData()
  const users = await upsertUsers(organization, await bcrypt.hash(password, 12))
  if (await Report.countDocuments({ orgId: organization._id }) === 0) {
    await seedReports(organization, users.filter(({ level }) => level === 0))
  }
  await recountActiveCases(organization._id, users.filter(({ level }) => level === 1).map(({ _id }) => _id))
  return { organization, users }
}
