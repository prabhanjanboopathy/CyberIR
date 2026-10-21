import { api } from '../api'
import { Empty, ProgressBar, Resource } from '../components/ui'
import { useLive, useResource } from '../hooks'

export default function Workload() {
  const { data, error, loading, reload } = useResource(api.engineers)
  useLive(reload)

  return (
    <section>
      <h1>Engineer workload &amp; availability</h1>
      <Resource loading={loading} error={error}>
        {data?.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Engineer</th><th>Specialties</th><th>Availability</th><th>Active cases</th><th>Load</th></tr></thead>
              <tbody>
                {data.map((engineer) => (
                  <tr key={engineer._id}>
                    <td>{engineer.name}</td>
                    <td>{engineer.specialties.join(', ')}</td>
                    <td><span className={`dot ${engineer.availability}`} /> {engineer.availability}</td>
                    <td>{engineer.activeCaseCount} / {engineer.maxActiveCases}</td>
                    <td><ProgressBar value={Math.round((engineer.activeCaseCount / engineer.maxActiveCases) * 100)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>No active engineers.</Empty>}
      </Resource>
    </section>
  )
}
