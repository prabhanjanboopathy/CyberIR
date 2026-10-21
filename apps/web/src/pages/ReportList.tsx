import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ATTACK_TYPES, SEVERITIES, STATUSES, type ReportFilters } from '../api'
import { useAuth } from '../auth'
import { Badge, Empty, ProgressBar, Resource } from '../components/ui'
import { formatDate } from '../format'
import { useLive, useResource } from '../hooks'

const TITLES = { mine: 'My reports', assigned: 'My assignments', all: 'All cases' }

function Filters({ filters, onChange }: { filters: ReportFilters; onChange: (filters: ReportFilters) => void }) {
  const { data: engineers } = useResource(api.engineers)
  const select = (key: keyof ReportFilters, label: string, options: readonly string[] | { value: string; label: string }[]) => (
    <select aria-label={label} value={filters[key] ?? ''} onChange={(event) => onChange({ ...filters, [key]: event.target.value || undefined })}>
      <option value="">{label}: all</option>
      {options.map((option) => typeof option === 'string' ? <option key={option}>{option}</option> : <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  )

  return (
    <div className="filters">
      {select('status', 'Status', STATUSES)}
      {select('attackType', 'Type', ATTACK_TYPES)}
      {select('severity', 'Severity', SEVERITIES)}
      {select('assignee', 'Assignee', [{ value: 'unassigned', label: 'Unassigned' }, ...(engineers ?? []).map((engineer) => ({ value: engineer._id, label: engineer.name }))])}
    </div>
  )
}

export default function ReportList({ mode }: { mode: keyof typeof TITLES }) {
  const { user } = useAuth()
  const [filters, setFilters] = useState<ReportFilters>({})
  const fetcher = useCallback(() => api.reports(filters), [filters])
  const { data, error, loading, reload } = useResource(fetcher)
  useLive(reload)
  const showAssignee = user.level >= 2

  return (
    <section>
      <header className="page-head">
        <h1>{TITLES[mode]}</h1>
        {mode === 'mine' && <Link className="button primary" to="/reports/new">Report an incident</Link>}
      </header>
      {mode === 'all' && <Filters filters={filters} onChange={setFilters} />}
      <Resource loading={loading} error={error}>
        {data?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Case</th><th>Title</th><th>Type</th><th>Severity</th><th>Status</th>{showAssignee && <th>Assignee</th>}<th>Progress</th><th>Opened</th></tr>
              </thead>
              <tbody>
                {data.map((report) => (
                  <tr key={report._id}>
                    <td><Link to={`/reports/${report._id}`}>{report.number}</Link></td>
                    <td>{report.title}</td>
                    <td>{report.attackType}</td>
                    <td><Badge value={report.severity} kind="severity" /></td>
                    <td><Badge value={report.status} kind="status" /></td>
                    {showAssignee && <td>{report.assignedTo?.name ?? <em className="muted">Unassigned</em>}</td>}
                    <td><ProgressBar value={report.progress} /></td>
                    <td>{formatDate(report.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>{mode === 'mine' ? 'You have not submitted any reports yet.' : 'No cases match.'}</Empty>}
      </Resource>
    </section>
  )
}
