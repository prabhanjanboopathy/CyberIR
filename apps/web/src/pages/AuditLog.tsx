import { api } from '../api'
import { useAuth } from '../auth'
import { Empty, Resource } from '../components/ui'
import { formatDate } from '../format'
import { useLive, useResource } from '../hooks'

const summarize = (value: unknown) => (value ? JSON.stringify(value) : '—')

export default function AuditLog() {
  const { user } = useAuth()
  const { data, error, loading, reload } = useResource(api.auditLogs)
  useLive(reload)

  return (
    <section>
      <h1>{user.level >= 3 ? 'System audit log' : 'Audit log'}</h1>
      <Resource loading={loading} error={error}>
        {data?.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Resource</th><th>Before</th><th>After</th></tr></thead>
              <tbody>
                {data.map((entry) => (
                  <tr key={entry._id}>
                    <td>{formatDate(entry.createdAt)}</td>
                    <td>{entry.actorId?.name ?? 'system'}</td>
                    <td>{entry.action}</td>
                    <td>{entry.resourceType}</td>
                    <td><code>{summarize(entry.before)}</code></td>
                    <td><code>{summarize(entry.after)}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>No audit entries yet.</Empty>}
      </Resource>
    </section>
  )
}
