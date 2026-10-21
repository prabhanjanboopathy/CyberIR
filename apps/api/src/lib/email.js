import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import nodemailer from 'nodemailer'

let smtpTransport

function getSmtpTransport() {
  if (smtpTransport) return smtpTransport
  smtpTransport = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: Number(process.env.MAIL_PORT ?? 587),
    secure: process.env.MAIL_SECURE === 'true',
    auth: process.env.MAIL_USER ? { user: process.env.MAIL_USER, pass: process.env.MAIL_PASSWORD } : undefined,
  })
  return smtpTransport
}

export async function deliverEmail({ to, subject, text, html }) {
  const from = process.env.MAIL_FROM ?? 'CyberIR <no-reply@localhost>'
  if (process.env.MAIL_HOST) {
    return getSmtpTransport().sendMail({ from, to, subject, text, html })
  }
  if (process.env.NODE_ENV === 'production') throw new Error('MAIL_HOST must be configured in production')

  const target = resolve(process.env.DEV_MAIL_DIR ?? 'var/mail', `${Date.now()}-${randomUUID()}.json`)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, JSON.stringify({ to, from, subject, text, html, createdAt: new Date().toISOString() }, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  return { messageId: `local-${randomUUID()}` }
}
