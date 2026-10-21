import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type ReassignmentRequest } from '../api'
import { Empty, ErrorMessage, Resource } from '../components/ui'
import { formatDate } from '../format'
import { useAction, useLive, useResource } from '../hooks'

function Review({ request, onDone }: { request: ReassignmentRequest; onDone: () => void }) {
  const { pending, error, run } = useAction()
  const [note, setNote] = useState('')
  const decide = (decision: 'approve' | 'reject') => run(async () => { await api.reviewReassignment(request._id, decision, note.trim()); onDone() })
  const noteMissing = note.trim().length < 3

  return (
    <div className="form">
      <textarea aria-label="Decision note" placeholder="Decision note (required)" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
      <ErrorMessage message={error} />
      <div className="actions">
        <button className="primary" disabled={pending || noteMissing} onClick={() => decide('approve')}>Approve &amp; reassign</button>
        <button disabled={pending || noteMissing} onClick={() => decide('reject')}>Reject</button>
      </div>
    </div>
  )
}

export default function Reassignments() {
  const { data, error, loading, reload } = useResource(api.reassignmentRequests)
  useLive(reload)

  return (
    <section>
      <h1>Reassignment requests</h1>
      <Resource loading={loading} error={error}>
        {data?.length ? data.map((request) => (
          <article key={request._id} className="card">
            <h2><Link to={`/reports/${request.reportId._id}`}>{request.reportId.number}</Link> {request.reportId.title}</h2>
            <p><b>{request.requesterId.name}</b> <small className="muted">{formatDate(request.createdAt)}</small></p>
            <p>{request.reason}</p>
            {request.status === 'pending' ? <Review request={request} onDone={reload} /> : (
              <p><span className="chip">{request.status}</span> {request.decidedBy?.name && `by ${request.decidedBy.name}`} {request.decisionNote && `— ${request.decisionNote}`}</p>
            )}
          </article>
        )) : <Empty>No reassignment requests.</Empty>}
      </Resource>
    </section>
  )
}
