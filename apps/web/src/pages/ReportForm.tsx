import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ATTACK_TYPES } from '../api'
import { ErrorMessage, Field } from '../components/ui'
import { useAction } from '../hooks'

const SCALE = [1, 2, 3, 4, 5]
const SCALES = [
  ['impact', 'Impact (1 low – 5 severe)'],
  ['urgency', 'Urgency (1 low – 5 immediate)'],
  ['assetCriticality', 'Asset criticality (1 low – 5 critical)'],
] as const

function validate(form: FormData) {
  const errors: Record<string, string> = {}
  if (String(form.get('title')).trim().length < 5) errors.title = 'Enter at least 5 characters'
  if (String(form.get('description')).trim().length < 20) errors.description = 'Describe what happened in at least 20 characters'
  if (String(form.get('affectedAsset')).trim().length < 2) errors.affectedAsset = 'Name the affected asset'
  return errors
}

export default function ReportForm() {
  const navigate = useNavigate()
  const { pending, error, run } = useAction()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [createdId, setCreatedId] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const found = validate(form)
    setErrors(found)
    if (Object.keys(found).length) return

    await run(async () => {
      const text = (name: string) => String(form.get(name)).trim()
      const report = await api.createReport({
        title: text('title'),
        description: text('description'),
        attackType: text('attackType'),
        affectedAsset: text('affectedAsset'),
        impact: Number(form.get('impact')),
        urgency: Number(form.get('urgency')),
        assetCriticality: Number(form.get('assetCriticality')),
      })
      const file = form.get('evidence')
      if (file instanceof File && file.size) {
        setCreatedId(report._id)
        await api.uploadEvidence(report._id, file)
      }
      navigate(`/reports/${report._id}`)
    })
  }

  return (
    <section>
      <h1>Report an incident</h1>
      <form className="card form" onSubmit={submit} noValidate>
        <Field label="Title" error={errors.title}><input name="title" maxLength={140} /></Field>
        <Field label="Description" error={errors.description}><textarea name="description" rows={5} maxLength={4000} /></Field>
        <div className="grid-2">
          <Field label="Attack type"><select name="attackType">{ATTACK_TYPES.map((type) => <option key={type}>{type}</option>)}</select></Field>
          <Field label="Affected asset" error={errors.affectedAsset}><input name="affectedAsset" maxLength={120} placeholder="e.g. FIN-WS-044" /></Field>
        </div>
        <div className="grid-3">
          {SCALES.map(([name, label]) => (
            <Field key={name} label={label}><select name={name} defaultValue="3">{SCALE.map((value) => <option key={value}>{value}</option>)}</select></Field>
          ))}
        </div>
        <Field label="Evidence (optional, max 25 MB)"><input type="file" name="evidence" /></Field>
        <ErrorMessage message={error} />
        {error && createdId && <p>Your report was submitted. <Link to={`/reports/${createdId}`}>View it</Link> and retry the upload there.</p>}
        <button className="primary" disabled={pending}>{pending ? 'Submitting…' : 'Submit report'}</button>
      </form>
    </section>
  )
}
