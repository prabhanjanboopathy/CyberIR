import { useCallback, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ENGINEER_STATUSES, STATUSES, type Report } from '../api'
import { useAuth } from '../auth'
import AssignmentPanel from '../components/AssignmentPanel'
import { HelpModal, ReassignModal } from '../components/RequestModals'
import { Badge, Empty, ErrorMessage, Field, ProgressBar, Resource } from '../components/ui'
import { formatDate } from '../format'
import { useAction, useLive, useResource } from '../hooks'

function Evidence({ id, onChange }: { id: string; onChange: () => void }) {
  const fetcher = useCallback(() => api.evidence(id), [id])
  const { data, error, loading, reload } = useResource(fetcher)
  const action = useAction()
  useLive(reload)

  const upload = (file?: File) => file && action.run(async () => { await api.uploadEvidence(id, file); reload(); onChange() })
  return (
    <div className="card">
      <h2>Evidence</h2>
      <Resource loading={loading} error={error}>
        {data?.length ? (
          <ul className="list">
            {data.map((item) => (
              <li key={item.id}>
                <button className="link" onClick={() => action.run(() => api.downloadEvidence(item.id, item.originalName))}>{item.originalName}</button>
                <small className="muted"> {(item.size / 1024).toFixed(1)} KB · scan: {item.scanStatus} · {formatDate(item.uploadedAt)}</small>
              </li>
            ))}
          </ul>
        ) : <Empty>No evidence attached.</Empty>}
      </Resource>
      <label className="button">Upload evidence<input type="file" hidden disabled={action.pending} onChange={(event) => { upload(event.target.files?.[0]); event.target.value = '' }} /></label>
      <ErrorMessage message={action.error} />
    </div>
  )
}

function StatusPanel({ report, onChange }: { report: Report; onChange: () => void }) {
  const { user } = useAuth()
  const { pending, error, run } = useAction()
  const [status, setStatus] = useState(report.status)
  const [progress, setProgress] = useState(report.progress)
  const [note, setNote] = useState('')
  const statuses = user.level >= 2 ? STATUSES : ENGINEER_STATUSES

  const save = (event: FormEvent) => {
    event.preventDefault()
    return run(async () => {
      await api.updateStatus(report._id, { status, progress, ...(note.trim() && { note: note.trim() }) })
      setNote('')
      onChange()
    })
  }
  const markSurveillance = () => run(async () => { await api.updateStatus(report._id, { status: 'Under Surveillance' }); onChange() })

  return (
    <form className="card form" onSubmit={save}>
      <h2>Update case</h2>
      <Field label="Status">
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          {!statuses.some((value) => value === report.status) && <option>{report.status}</option>}
          {statuses.map((value) => <option key={value}>{value}</option>)}
        </select>
      </Field>
      <Field label={`Progress: ${progress}%`}><input type="range" min={0} max={100} step={5} value={progress} onChange={(event) => setProgress(Number(event.target.value))} /></Field>
      <Field label="Note (optional)"><textarea rows={3} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} /></Field>
      <ErrorMessage message={error} />
      <div className="actions">
        <button className="primary" disabled={pending}>Save</button>
        {user.level >= 2 && report.status !== 'Under Surveillance' && <button type="button" disabled={pending} onClick={markSurveillance}>Mark under surveillance</button>}
      </div>
    </form>
  )
}

function Notes({ report, onChange }: { report: Report; onChange: () => void }) {
  const { pending, error, run } = useAction()
  const [body, setBody] = useState('')
  const add = (event: FormEvent) => {
    event.preventDefault()
    return run(async () => { await api.addNote(report._id, body.trim()); setBody(''); onChange() })
  }

  return (
    <div className="card">
      <h2>Notes</h2>
      {report.notes?.length ? (
        <ul className="list">{report.notes.map((note) => <li key={note.at}><b>{note.authorName}</b> <small className="muted">{formatDate(note.at)}</small><p>{note.body}</p></li>)}</ul>
      ) : <Empty>No notes yet.</Empty>}
      <form className="form" onSubmit={add}>
        <textarea aria-label="New note" rows={2} maxLength={4000} value={body} onChange={(event) => setBody(event.target.value)} />
        <ErrorMessage message={error} />
        <button disabled={pending || !body.trim()}>Add note</button>
      </form>
    </div>
  )
}

function Requests({ report }: { report: Report }) {
  const items = [
    ...(report.helpRequests ?? []).map((item) => ({ id: item._id, text: `Help: ${item.requesterId.name} → ${item.targetId.name} — ${item.message}`, status: item.status })),
    ...(report.reassignmentRequests ?? []).map((item) => ({ id: item._id, text: `Change request by ${item.requesterId.name} — ${item.reason}${item.decisionNote ? ` (decision: ${item.decisionNote})` : ''}`, status: item.status })),
  ]
  if (!items.length) return null
  return (
    <div className="card">
      <h2>Requests</h2>
      <ul className="list">{items.map((item) => <li key={item.id}>{item.text} <span className="chip">{item.status}</span></li>)}</ul>
    </div>
  )
}

export default function ReportDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const fetcher = useCallback(() => api.report(id), [id])
  const { data: report, error, loading, reload } = useResource(fetcher)
  const [modal, setModal] = useState<'help' | 'reassign' | null>(null)
  useLive(reload)

  const finished = report?.status === 'Completed' || report?.status === 'Closed'
  const isAssignee = report?.assignedTo?._id === user.id
  const canUpdate = user.level >= 2 || (user.level === 1 && isAssignee)
  const done = () => { setModal(null); reload() }

  return (
    <section>
      <button className="link" onClick={() => navigate(-1)}>← Back</button>
      <Resource loading={loading} error={error}>
        {report && (
          <>
            <header className="page-head">
              <div>
                <small className="muted">{report.number}</small>
                <h1>{report.title}</h1>
                <Badge value={report.status} kind="status" /> <Badge value={report.severity} kind="severity" />
              </div>
              {user.level === 1 && isAssignee && !finished && (
                <div className="actions">
                  <button onClick={() => setModal('help')}>Request help</button>
                  <button onClick={() => setModal('reassign')}>Request case change</button>
                </div>
              )}
            </header>
            <div className="detail">
              <div className="stack">
                <div className="card">
                  <p>{report.description}</p>
                  <dl className="facts">
                    <dt>Attack type</dt><dd>{report.attackType}</dd>
                    <dt>Affected asset</dt><dd>{report.affectedAsset}</dd>
                    <dt>Impact / urgency</dt><dd>{report.impact} / {report.urgency}</dd>
                    <dt>Reported by</dt><dd>{report.reporterId.name} on {formatDate(report.createdAt)}</dd>
                    {user.level > 0 && (
                      <>
                        <dt>Assigned to</dt><dd>{report.assignedTo?.name ?? 'Unassigned'}{report.assignmentReason && <small className="muted"> — {report.assignmentReason}</small>}</dd>
                        <dt>Collaborators</dt><dd>{report.collaborators?.map((person) => person.name).join(', ') || '—'}</dd>
                      </>
                    )}
                    <dt>Progress</dt><dd><ProgressBar value={report.progress} /></dd>
                  </dl>
                </div>
                <Evidence id={report._id} onChange={reload} />
                {user.level > 0 && <Notes report={report} onChange={reload} />}
              </div>
              {user.level > 0 && (
                <div className="stack">
                  {canUpdate && <StatusPanel key={`${report.status}-${report.progress}`} report={report} onChange={reload} />}
                  {user.level >= 2 && <AssignmentPanel key={`${report.assignedTo?._id}-${report.collaborators?.length}-${report.severity}`} report={report} onChange={reload} />}
                  <Requests report={report} />
                  {user.level >= 2 && report.assignmentHistory && (
                    <div className="card">
                      <h2>Assignment history</h2>
                      <ul className="list">{report.assignmentHistory.map((entry) => <li key={entry.at}>{formatDate(entry.at)} — {entry.reason} <small className="muted">({entry.by === 'auto' ? 'auto' : 'manual'})</small></li>)}</ul>
                    </div>
                  )}
                </div>
              )}
            </div>
            {modal === 'help' && <HelpModal reportId={report._id} onClose={() => setModal(null)} onDone={done} />}
            {modal === 'reassign' && <ReassignModal reportId={report._id} onClose={() => setModal(null)} onDone={done} />}
          </>
        )}
      </Resource>
    </section>
  )
}
