import { apiBaseUrl } from './config'

export const LEVEL_TITLES = ['Reporter', 'Cybersecurity Engineer', 'Risk Analyst', 'Admin'] as const
export const ATTACK_TYPES = ['Malware', 'Trojan Horse', 'Ransomware', 'Phishing', 'DDoS', 'Network Intrusion', 'Insider Threat', 'Data Breach', 'Other'] as const
export const STATUSES = ['Yet to Assess', 'Under Assessment', 'Under Surveillance', 'In Progress', 'Completed', 'Closed'] as const
export const ENGINEER_STATUSES = ['Under Assessment', 'In Progress', 'Completed'] as const
export const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'] as const
export const SPECIALTIES = ['Malware', 'Trojan Horse', 'Phishing/Social Engineering', 'Ransomware', 'DDoS/Network Intrusion'] as const
export const AVAILABILITY = ['available', 'busy', 'offline'] as const

export type Availability = (typeof AVAILABILITY)[number]
export type Person = { _id: string; name: string; title?: string }
export type DemoAccount = Pick<SessionUser, 'name' | 'email' | 'level' | 'title'>

export type SessionUser = {
  id: string
  name: string
  email: string
  level: number
  title: string
  mfaEnabled?: boolean
  availability?: Availability
  activeCaseCount?: number
  maxActiveCases?: number
}
export type Engineer = Person & { specialties: string[]; availability: Availability; activeCaseCount: number; maxActiveCases: number }
export type ManagedUser = Engineer & { email: string; level: number; isActive: boolean }
export type Note = { authorName: string; body: string; at: string }
export type HelpRequest = {
  _id: string
  status: string
  message: string
  createdAt: string
  requesterId: Person
  targetId: Person
  reportId: { _id: string; number: string; title: string; attackType: string; severity: string }
}
export type ReassignmentRequest = {
  _id: string
  status: string
  reason: string
  decisionNote?: string
  createdAt: string
  requesterId: Person
  decidedBy?: Person
  reportId: { _id: string; number: string; title: string; assignedTo?: Person }
}
export type Report = {
  _id: string
  number: string
  title: string
  description: string
  attackType: string
  affectedAsset: string
  impact: number
  urgency: number
  severity: string
  status: string
  progress: number
  createdAt: string
  reporterId: Person
  assignedTo?: Person | null
  assignedBy?: string
  assignmentReason?: string
  collaborators?: Person[]
  notes?: Note[]
  assignmentHistory?: { at: string; to: string | null; by: string; reason: string }[]
  severityOverride?: { previous: string; justification: string; at: string }
  helpRequests?: { _id: string; status: string; message: string; requesterId: Person; targetId: Person }[]
  reassignmentRequests?: { _id: string; status: string; reason: string; decisionNote?: string; requesterId: Person }[]
}
export type ReportFilters = { status?: string; attackType?: string; severity?: string; assignee?: string }
export type NewReport = {
  title: string
  description: string
  attackType: string
  affectedAsset: string
  impact: number
  urgency: number
  assetCriticality: number
}
export type Evidence = { id: string; originalName: string; size: number; scanStatus: string; sha256: string; uploadedAt: string }
export type AuditEntry = {
  _id: string
  action: string
  resourceType: string
  resourceId: string
  createdAt: string
  actorId: Person | null
  before: unknown
  after: unknown
}
type Count = { _id: string; count: number }
export type Summary = {
  totals: { total: number; active: number; unassigned: number }
  byStatus: Count[]
  bySeverity: Count[]
  byAttackType: Count[]
  daily: Count[]
}
export type UserInput = Partial<Pick<ManagedUser, 'name' | 'level' | 'isActive' | 'specialties' | 'maxActiveCases' | 'availability'>> & { password?: string }

type Tokens = { accessToken: string; refreshToken: string }
const ACCESS_KEY = 'cyberir-access-token'
const REFRESH_KEY = 'cyberir-refresh-token'

export const getAccessToken = () => sessionStorage.getItem(ACCESS_KEY)
export const hasSession = () => Boolean(sessionStorage.getItem(REFRESH_KEY))

function storeTokens({ accessToken, refreshToken }: Tokens) {
  sessionStorage.setItem(ACCESS_KEY, accessToken)
  sessionStorage.setItem(REFRESH_KEY, refreshToken)
}

export function clearTokens() {
  sessionStorage.removeItem(ACCESS_KEY)
  sessionStorage.removeItem(REFRESH_KEY)
}

let onSessionExpired = () => {}
export const setSessionExpiredHandler = (handler: () => void) => { onSessionExpired = handler }

let refreshing: Promise<boolean> | null = null
function refreshTokens() {
  refreshing ??= (async () => {
    const refreshToken = sessionStorage.getItem(REFRESH_KEY)
    if (!refreshToken) return false
    const response = await fetch(`${apiBaseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => null)
    if (!response?.ok) return false
    storeTokens((await response.json()).data)
    return true
  })().finally(() => { refreshing = null })
  return refreshing
}

export class ApiError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

type RequestOptions = { method?: string; body?: unknown; form?: FormData; auth?: boolean }

async function send(path: string, { method = 'GET', body, form, auth = true }: RequestOptions) {
  const token = getAccessToken()
  return fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(auth && token && { Authorization: `Bearer ${token}` }),
    },
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  })
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (options.auth !== false && !getAccessToken()) await refreshTokens()
  let response = await send(path, options)
  if (response.status === 401 && options.auth !== false && (await refreshTokens())) response = await send(path, options)
  if (response.status === 401 && options.auth !== false) onSessionExpired()
  if (response.status === 204) return undefined as T
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const issues = payload.error?.details?.map?.((detail: { field: string; issue: string }) => `${detail.field}: ${detail.issue}`).join('; ')
    throw new ApiError(issues || payload.error?.message || `Request failed (${response.status})`, payload.error?.code)
  }
  return payload.data as T
}

const query = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])))
  return search.size ? `?${search}` : ''
}
const patch = <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body })
const post = <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body })

export async function login(email: string, password: string, code?: string) {
  const second = code && (/^\d{6}$/.test(code) ? { totpCode: code } : { recoveryCode: code })
  const result = await request<Tokens & { user: SessionUser }>('/auth/login', { method: 'POST', body: { email, password, ...second }, auth: false })
  storeTokens(result)
  return result.user
}

export async function demoLogin(email: string) {
  const result = await request<Tokens & { user: SessionUser }>('/auth/demo-login', { method: 'POST', body: { email }, auth: false })
  storeTokens(result)
  return result.user
}

export const demoAccounts = () => request<DemoAccount[]>('/auth/demo-accounts', { auth: false })

export async function logout() {
  const refreshToken = sessionStorage.getItem(REFRESH_KEY)
  clearTokens()
  if (refreshToken) await request('/auth/logout', { method: 'POST', body: { refreshToken }, auth: false }).catch(() => undefined)
}

export const api = {
  me: () => request<SessionUser>('/auth/me'),
  summary: () => request<Summary>('/analytics/summary'),
  reports: (filters: ReportFilters = {}) => request<Report[]>(`/reports${query(filters)}`),
  report: (id: string) => request<Report>(`/reports/${id}`),
  createReport: (input: NewReport) => post<Report>('/reports', input),
  updateStatus: (id: string, input: { status?: string; progress?: number; note?: string }) => patch<Report>(`/reports/${id}/status`, input),
  addNote: (id: string, body: string) => post<Report>(`/reports/${id}/notes`, { body }),
  assign: (id: string, input: { assigneeId?: string | null; collaboratorIds?: string[]; reason?: string }) => patch<Report>(`/reports/${id}/assignment`, input),
  overrideSeverity: (id: string, severity: string, justification: string) => patch<Report>(`/reports/${id}/severity`, { severity, justification }),
  evidence: (id: string) => request<Evidence[]>(`/reports/${id}/evidence`),
  uploadEvidence: (id: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<Evidence>(`/reports/${id}/evidence`, { method: 'POST', form })
  },
  downloadEvidence: async (id: string, name: string) => {
    const response = await send(`/evidence/${id}/download`, {})
    if (!response.ok) throw new ApiError('Download failed')
    const url = URL.createObjectURL(await response.blob())
    Object.assign(document.createElement('a'), { href: url, download: name }).click()
    URL.revokeObjectURL(url)
  },
  engineers: () => request<Engineer[]>('/users/engineers'),
  setAvailability: (availability: Availability) => patch<SessionUser>('/users/me/availability', { availability }),
  helpRequests: () => request<HelpRequest[]>('/help-requests'),
  requestHelp: (id: string, targetId: string, message: string) => post(`/reports/${id}/help-requests`, { targetId, message }),
  answerHelp: (id: string, decision: 'accept' | 'decline') => patch(`/help-requests/${id}`, { decision }),
  requestReassignment: (id: string, reason: string) => post(`/reports/${id}/reassignment-requests`, { reason }),
  reassignmentRequests: () => request<ReassignmentRequest[]>('/reassignment-requests'),
  reviewReassignment: (id: string, decision: 'approve' | 'reject', note: string) => patch(`/reassignment-requests/${id}`, { decision, note }),
  auditLogs: () => request<AuditEntry[]>('/audit-logs?limit=200'),
  users: () => request<ManagedUser[]>('/users'),
  createUser: (input: UserInput & { email: string; name: string; password: string; level: number }) => post<ManagedUser>('/users', input),
  updateUser: (id: string, input: UserInput) => patch<ManagedUser>(`/users/${id}`, input),
}
