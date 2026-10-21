import { Link } from 'react-router-dom'
import { api } from '../api'
import { Badge, Empty, ErrorMessage, Resource } from '../components/ui'
import { formatDate } from '../format'
import { useAction, useLive, useResource } from '../hooks'

export default function HelpInbox() {
  const { data, error, loading, reload } = useResource(api.helpRequests)
  const action = useAction()
  useLive(reload)
  const answer = (id: string, decision: 'accept' | 'decline') => action.run(async () => { await api.answerHelp(id, decision); reload() })

  return (
    <section>
      <h1>Help requests</h1>
      <ErrorMessage message={action.error} />
      <Resource loading={loading} error={error}>
        {data?.length ? data.map((request) => (
          <article key={request._id} className="card">
            <header className="page-head">
              <h2><Link to={`/reports/${request.reportId._id}`}>{request.reportId.number}</Link> {request.reportId.title}</h2>
              <Badge value={request.reportId.severity} kind="severity" />
            </header>
            <p><b>{request.requesterId.name}</b> <small className="muted">{formatDate(request.createdAt)}</small></p>
            <p>{request.message}</p>
            {request.status === 'pending' ? (
              <div className="actions">
                <button className="primary" disabled={action.pending} onClick={() => answer(request._id, 'accept')}>Accept</button>
                <button disabled={action.pending} onClick={() => answer(request._id, 'decline')}>Decline</button>
              </div>
            ) : <span className="chip">{request.status}</span>}
          </article>
        )) : <Empty>No help requests.</Empty>}
      </Resource>
    </section>
  )
}
