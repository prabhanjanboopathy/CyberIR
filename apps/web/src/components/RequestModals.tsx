import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { useAction, useResource } from '../hooks'
import { ErrorMessage, Field, Loading, Modal } from './ui'

type Props = { reportId: string; onClose: () => void; onDone: () => void }

export function HelpModal({ reportId, onClose, onDone }: Props) {
  const { user } = useAuth()
  const { data: engineers, error: loadError } = useResource(api.engineers)
  const { pending, error, run } = useAction()
  const [targetId, setTargetId] = useState('')
  const [message, setMessage] = useState('')
  const colleagues = engineers?.filter((engineer) => engineer._id !== user.id)
  const tooShort = message.trim().length < 5

  const submit = (event: FormEvent) => {
    event.preventDefault()
    return run(async () => { await api.requestHelp(reportId, targetId, message.trim()); onDone() })
  }

  return (
    <Modal title="Request help from a colleague" onClose={onClose}>
      {!colleagues ? <Loading /> : (
        <form className="form" onSubmit={submit}>
          <Field label="Colleague">
            <select required value={targetId} onChange={(event) => setTargetId(event.target.value)}>
              <option value="">Select an engineer…</option>
              {colleagues.map((engineer) => <option key={engineer._id} value={engineer._id}>{engineer.name} — {engineer.specialties[0]} ({engineer.availability})</option>)}
            </select>
          </Field>
          <Field label="Message" error={message && tooShort ? 'Enter at least 5 characters' : undefined}>
            <textarea required rows={4} maxLength={1000} value={message} onChange={(event) => setMessage(event.target.value)} />
          </Field>
          <ErrorMessage message={error || loadError} />
          <button className="primary" disabled={pending || !targetId || tooShort}>{pending ? 'Sending…' : 'Send request'}</button>
        </form>
      )}
    </Modal>
  )
}

export function ReassignModal({ reportId, onClose, onDone }: Props) {
  const { pending, error, run } = useAction()
  const [reason, setReason] = useState('')
  const tooShort = reason.trim().length < 15

  const submit = (event: FormEvent) => {
    event.preventDefault()
    return run(async () => { await api.requestReassignment(reportId, reason.trim()); onDone() })
  }

  return (
    <Modal title="Request a case change" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="muted">A Risk Analyst will review your request. The case stays with you until it is approved.</p>
        <Field label="Reason (required, min. 15 characters)" error={reason && tooShort ? `${15 - reason.trim().length} more characters needed` : undefined}>
          <textarea required rows={4} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <ErrorMessage message={error} />
        <button className="primary" disabled={pending || tooShort}>{pending ? 'Sending…' : 'Submit request'}</button>
      </form>
    </Modal>
  )
}
