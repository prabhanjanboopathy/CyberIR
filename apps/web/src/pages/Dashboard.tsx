import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api'
import { Resource } from '../components/ui'
import { useLive, useResource } from '../hooks'

const COLORS: Record<string, string> = { Low: '#3e856c', Medium: '#c28131', High: '#d9733f', Critical: '#bd574e' }

export default function Dashboard() {
  const { data, error, loading, reload } = useResource(api.summary)
  useLive(reload)
  const rows = (items: { _id: string; count: number }[]) => items.map(({ _id, count }) => ({ name: _id, count }))

  return (
    <section>
      <h1>Dashboard</h1>
      <Resource loading={loading} error={error}>
        {data && (
          <>
            <div className="stats">
              <div className="card"><b>{data.totals.total}</b><span>Total cases</span></div>
              <div className="card"><b>{data.totals.active}</b><span>Active</span></div>
              <div className="card"><b>{data.totals.unassigned}</b><span>Unassigned</span></div>
            </div>
            <div className="charts">
              <div className="card">
                <h2>By status</h2>
                <ResponsiveContainer width="100%" height={220}><BarChart data={rows(data.byStatus)}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" fontSize={11} /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" fill="#3e856c" /></BarChart></ResponsiveContainer>
              </div>
              <div className="card">
                <h2>By severity</h2>
                <ResponsiveContainer width="100%" height={220}><PieChart><Pie data={rows(data.bySeverity)} dataKey="count" nameKey="name" label>{data.bySeverity.map((item) => <Cell key={item._id} fill={COLORS[item._id]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
              </div>
              <div className="card">
                <h2>By attack type</h2>
                <ResponsiveContainer width="100%" height={220}><BarChart data={rows(data.byAttackType)} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="name" width={110} fontSize={11} /><Tooltip /><Bar dataKey="count" fill="#c28131" /></BarChart></ResponsiveContainer>
              </div>
              <div className="card">
                <h2>Reports, last 14 days</h2>
                <ResponsiveContainer width="100%" height={220}><LineChart data={rows(data.daily)}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" fontSize={11} /><YAxis allowDecimals={false} /><Tooltip /><Line dataKey="count" stroke="#bd574e" /></LineChart></ResponsiveContainer>
              </div>
            </div>
          </>
        )}
      </Resource>
    </section>
  )
}
