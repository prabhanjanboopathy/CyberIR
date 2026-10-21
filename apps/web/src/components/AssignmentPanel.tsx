import { useState, type FormEvent } from 'react'
import { api, SEVERITIES, type Report } from '../api'
import { useAction, useResource } from '../hooks'
import { ErrorMessage, Field, Resource } from './ui'
import { formatDate } from '../format'

export default function AssignmentPanel({ report, onChange }: { report: Report; onChange: () => void }) {
  const { data: engineers, error: loadError, loading } = useResource(api.engineers)
  const { pending, error, run } = useAction()
  const [assigneeId, setAssigneeId] = useState(report.assignedTo?._id ?? '')
  const [collaborators, setCollaborators] = useState(report.collaborators?.map((person) => person._id) ?? [])
  const [severity, setSeverity] = useState(report.severity)
  const [justification, setJustification] = useState('')

  const toggle = (id: string) => setCollaborators((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const saveAssignment = () => run(async () => {
    await api.assign(report._id, { assigneeId: assigneeId || null, collaboratorIds: collaborators.filter((id) => id !== assigneeId), reason: 'manual assignment by Risk Analyst' })
    onChange()
  })
  const saveSeverity = (event: FormEvent) => {
    event.preventDefault()
    return run(async () => { await api.overrideSeverity(report._id, severity, justification.trim()); setJustification(''); onChange() })
  }

  return (
    <div className="card form">
      <h2>Assignment</h2>
      <Resource loading={loading} error={loadError}>
        <Field label="Assigned engineer">
          <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
            <option value="">Unassigned</option>
            {engineers?.map((engineer) => <option key={engineer._id} value={engineer._id}>{engineer.name} — {engineer.specialties[0]} · {engineer.availability} · {engineer.activeCaseCount}/{engineer.maxActiveCases}</option>)}
          </select>
        </Field>
        <fieldset>
          <legend>Collaborators</legend>
          {engineers?.filter((engineer) => engineer._id !== assigneeId).map((engineer) => (
            <label key={engineer._id} className="check"><input type="checkbox" checked={collaborators.includes(engineer._id)} onChange={() => toggle(engineer._id)} /> {engineer.name}</label>
          ))}
        </fieldset>
        <button className="primary" disabled={pending} onClick={saveAssignment} type="button">Save assignment</button>
      </Resource>
      <ErrorMessage message={error} />
      <form className="form" onSubmit={saveSeverity}>
        <h2>Override severity</h2>
        <Field label="Severity"><select value={severity} onChange={(event) => setSeverity(event.target.value)}>{SEVERITIES.map((value) => <option key={value}>{value}</option>)}</select></Field>
        <Field label="Justification (min. 10 characters)"><textarea rows={2} value={justification} onChange={(event) => setJustification(event.target.value)} /></Field>
        <button disabled={pending || severity === report.severity || justification.trim().length < 10}>Apply override</button>
        {report.severityOverride && <small className="muted">Last override from {report.severityOverride.previous} on {formatDate(report.severityOverride.at)}: {report.severityOverride.justification}</small>}
      </form>
    </div>
  )
}
