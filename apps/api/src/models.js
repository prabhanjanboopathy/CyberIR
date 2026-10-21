import mongoose from 'mongoose'
import { ATTACK_TYPES, AVAILABILITY, DEFAULT_MAX_ACTIVE_CASES, LEVELS, SEVERITIES, SPECIALTIES, STATUSES } from './constants.js'

const { Schema } = mongoose
const objectId = Schema.Types.ObjectId

const organizationSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  slug: { type: String, required: true, lowercase: true, trim: true, unique: true },
}, { timestamps: true })

const userSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, lowercase: true, trim: true, unique: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  orgId: { type: objectId, ref: 'Organization', required: true, index: true },
  level: { type: Number, enum: Object.keys(LEVELS).map(Number), required: true, default: 0, index: true },
  title: { type: String, required: true, maxlength: 60 },
  isActive: { type: Boolean, default: true },
  specialties: { type: [{ type: String, enum: SPECIALTIES }], default: undefined },
  availability: { type: String, enum: AVAILABILITY, default: undefined },
  activeCaseCount: { type: Number, min: 0, default: undefined },
  maxActiveCases: { type: Number, min: 1, max: 50, default: undefined },
  mfaEnabled: { type: Boolean, default: false },
  mfaSecretEncrypted: { type: String, select: false },
  pendingMfaSecretEncrypted: { type: String, select: false },
  recoveryCodeHashes: { type: [String], select: false, default: [] },
  pushToken: { type: String, default: null, maxlength: 300 },
  pushEnabled: { type: Boolean, default: false },
}, {
  timestamps: true,
  collection: 'users',
  toJSON: { transform: (_doc, ret) => { delete ret.passwordHash; return ret } },
})

userSchema.pre('validate', function applyEngineerDefaults() {
  if (this.level !== 1) return
  this.specialties ??= []
  this.availability ??= 'available'
  this.activeCaseCount ??= 0
  this.maxActiveCases ??= DEFAULT_MAX_ACTIVE_CASES
})

const assignmentEntrySchema = new Schema({
  at: { type: Date, default: Date.now },
  from: { type: objectId, ref: 'User', default: null },
  to: { type: objectId, ref: 'User', default: null },
  by: { type: String, required: true },
  reason: { type: String, required: true, maxlength: 300 },
}, { _id: false })

const noteSchema = new Schema({
  authorId: { type: objectId, ref: 'User', required: true },
  authorName: { type: String, required: true },
  body: { type: String, required: true, trim: true, maxlength: 4000 },
  at: { type: Date, default: Date.now },
}, { _id: false })

const reportSchema = new Schema({
  orgId: { type: objectId, ref: 'Organization', required: true },
  number: { type: String, required: true },
  title: { type: String, required: true, trim: true, maxlength: 140 },
  description: { type: String, required: true, trim: true, maxlength: 4000 },
  attackType: { type: String, enum: ATTACK_TYPES, required: true },
  affectedAsset: { type: String, required: true, trim: true, maxlength: 120 },
  impact: { type: Number, required: true, min: 1, max: 5 },
  urgency: { type: Number, required: true, min: 1, max: 5 },
  assetCriticality: { type: Number, required: true, min: 1, max: 5 },
  severity: { type: String, enum: SEVERITIES, required: true },
  severityScore: { type: Number, required: true, min: 1, max: 125 },
  severityOverride: {
    previous: { type: String, enum: SEVERITIES },
    justification: { type: String, maxlength: 1000 },
    actorId: { type: objectId, ref: 'User' },
    at: Date,
  },
  status: { type: String, enum: STATUSES, default: 'Yet to Assess' },
  progress: { type: Number, min: 0, max: 100, default: 0 },
  reporterId: { type: objectId, ref: 'User', required: true },
  assignedTo: { type: objectId, ref: 'User', default: null },
  assignedBy: { type: String, default: null },
  assignmentReason: { type: String, default: null, maxlength: 300 },
  assignmentHistory: { type: [assignmentEntrySchema], default: [] },
  collaborators: [{ type: objectId, ref: 'User' }],
  notes: { type: [noteSchema], default: [] },
  closedAt: Date,
}, { timestamps: true, collection: 'reports' })
reportSchema.index({ orgId: 1, number: 1 }, { unique: true })
reportSchema.index({ orgId: 1, status: 1, severity: 1, createdAt: -1 })
reportSchema.index({ orgId: 1, assignedTo: 1, status: 1 })
reportSchema.index({ orgId: 1, reporterId: 1, createdAt: -1 })
reportSchema.index({ orgId: 1, collaborators: 1 })

const helpRequestSchema = new Schema({
  orgId: { type: objectId, ref: 'Organization', required: true },
  reportId: { type: objectId, ref: 'Report', required: true },
  requesterId: { type: objectId, ref: 'User', required: true },
  targetId: { type: objectId, ref: 'User', required: true },
  message: { type: String, required: true, trim: true, maxlength: 1000 },
  status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
  respondedAt: Date,
}, { timestamps: true, collection: 'helprequests' })
helpRequestSchema.index({ orgId: 1, targetId: 1, status: 1, createdAt: -1 })

const reassignmentRequestSchema = new Schema({
  orgId: { type: objectId, ref: 'Organization', required: true },
  reportId: { type: objectId, ref: 'Report', required: true },
  requesterId: { type: objectId, ref: 'User', required: true },
  reason: { type: String, required: true, trim: true, maxlength: 1000 },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  decidedBy: { type: objectId, ref: 'User' },
  decisionNote: { type: String, trim: true, maxlength: 1000 },
  decidedAt: Date,
}, { timestamps: true, collection: 'reassignmentrequests' })
reassignmentRequestSchema.index({ orgId: 1, status: 1, createdAt: -1 })

const auditLogSchema = new Schema({
  orgId: { type: objectId, ref: 'Organization', required: true, index: true },
  actorId: { type: objectId, ref: 'User', default: null },
  action: { type: String, required: true, maxlength: 80 },
  resourceType: { type: String, required: true, maxlength: 60 },
  resourceId: { type: String, required: true },
  before: { type: Schema.Types.Mixed, default: null },
  after: { type: Schema.Types.Mixed, default: null },
  requestId: { type: String, maxlength: 100 },
}, { timestamps: true, versionKey: false, collection: 'auditlogs' })
auditLogSchema.index({ orgId: 1, createdAt: -1 })
auditLogSchema.index({ orgId: 1, resourceType: 1, resourceId: 1, createdAt: -1 })

const counterSchema = new Schema({
  orgId: { type: objectId, ref: 'Organization', required: true },
  year: { type: Number, required: true },
  sequence: { type: Number, default: 0 },
})
counterSchema.index({ orgId: 1, year: 1 }, { unique: true })

const refreshSessionSchema = new Schema({
  userId: { type: objectId, ref: 'User', required: true, index: true },
  orgId: { type: objectId, ref: 'Organization', required: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
}, { timestamps: true })
refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const passwordResetSchema = new Schema({
  userId: { type: objectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date, default: null },
}, { timestamps: true })
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const evidenceSchema = new Schema({
  orgId: { type: objectId, ref: 'Organization', required: true },
  reportId: { type: objectId, ref: 'Report', required: true },
  uploadedBy: { type: objectId, ref: 'User', required: true },
  objectKey: { type: String, required: true },
  storageProvider: { type: String, enum: ['local', 's3'], required: true },
  originalName: { type: String, required: true, maxlength: 180 },
  contentType: { type: String, required: true, maxlength: 120 },
  size: { type: Number, required: true, min: 1, max: 25 * 1024 * 1024 },
  sha256: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  scanStatus: { type: String, enum: ['not_scanned', 'clean', 'infected', 'pending', 'scan_failed'], default: 'not_scanned' },
  classification: { type: String, enum: ['internal', 'confidential', 'restricted'], default: 'confidential' },
  custodySequence: { type: Number, default: 0 },
  lastCustodyHash: { type: String, default: null },
  retentionUntil: { type: Date },
  deletedAt: { type: Date, default: null },
}, { timestamps: true, optimisticConcurrency: true })
evidenceSchema.index({ orgId: 1, reportId: 1, createdAt: -1 })
evidenceSchema.index({ orgId: 1, objectKey: 1 }, { unique: true })

const custodyEventSchema = new Schema({
  orgId: { type: objectId, ref: 'Organization', required: true },
  reportId: { type: objectId, ref: 'Report', required: true },
  evidenceId: { type: objectId, ref: 'Evidence', required: true },
  sequence: { type: Number, required: true, min: 1 },
  actorId: { type: objectId, ref: 'User', default: null },
  action: { type: String, enum: ['uploaded', 'viewed', 'downloaded', 'verified', 'quarantined', 'deleted'], required: true },
  reason: { type: String, maxlength: 1000 },
  occurredAt: { type: Date, required: true },
  previousHash: { type: String, default: null },
  eventHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
}, { timestamps: false, versionKey: false })
custodyEventSchema.index({ orgId: 1, evidenceId: 1, sequence: 1 }, { unique: true })

const model = (name, schema) => mongoose.models[name] ?? mongoose.model(name, schema)

export const Organization = model('Organization', organizationSchema)
export const User = model('User', userSchema)
export const Report = model('Report', reportSchema)
export const HelpRequest = model('HelpRequest', helpRequestSchema)
export const ReassignmentRequest = model('ReassignmentRequest', reassignmentRequestSchema)
export const AuditLog = model('AuditLog', auditLogSchema)
export const Evidence = model('Evidence', evidenceSchema)
export const CustodyEvent = model('CustodyEvent', custodyEventSchema)
export const Counter = model('Counter', counterSchema)
export const RefreshSession = model('RefreshSession', refreshSessionSchema)
export const PasswordReset = model('PasswordReset', passwordResetSchema)
