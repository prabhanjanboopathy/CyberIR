import { useState, type FormEvent } from 'react'
import { api, LEVEL_TITLES, SPECIALTIES, type ManagedUser } from '../api'
import { useAuth } from '../auth'
import { Badge, ErrorMessage, Field, Modal, Resource } from '../components/ui'
import { useAction, useLive, useResource } from '../hooks'

function UserModal({ target, onClose, onDone }: { target?: ManagedUser; onClose: () => void; onDone: () => void }) {
  const { user } = useAuth()
  const { pending, error, run } = useAction()
  const [level, setLevel] = useState(target?.level ?? 0)
  const [specialties, setSpecialties] = useState<string[]>(target?.specialties ?? [])
  const isSelf = target?._id === user.id

  const toggle = (value: string) => setSpecialties((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = (name: string) => String(form.get(name) ?? '').trim()
    const engineer = level === 1 && { specialties, maxActiveCases: Number(form.get('maxActiveCases')) }
    return run(async () => {
      if (target) {
        await api.updateUser(target._id, { name: text('name'), level, isActive: form.get('isActive') === 'on', ...engineer, ...(text('password') && { password: text('password') }) })
      } else {
        await api.createUser({ name: text('name'), email: text('email'), password: text('password'), level, ...engineer })
      }
      onDone()
    })
  }

  return (
    <Modal title={target ? `Edit ${target.name}` : 'Create user'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <Field label="Name"><input name="name" required minLength={2} defaultValue={target?.name} /></Field>
        {!target && <Field label="Email"><input name="email" type="email" required /></Field>}
        <Field label={target ? 'New password (leave blank to keep)' : 'Password (min. 12 characters)'}>
          <input name="password" type="password" minLength={12} required={!target} autoComplete="new-password" />
        </Field>
        <Field label="Level">
          <select value={level} disabled={isSelf} onChange={(event) => setLevel(Number(event.target.value))}>
            {LEVEL_TITLES.map((title, value) => <option key={title} value={value}>L{value} · {title}</option>)}
          </select>
        </Field>
        {level === 1 && (
          <>
            <fieldset>
              <legend>Specialties</legend>
              {SPECIALTIES.map((value) => <label key={value} className="check"><input type="checkbox" checked={specialties.includes(value)} onChange={() => toggle(value)} /> {value}</label>)}
              <small className="muted">The first specialty selected is the primary one; the rest are secondary.</small>
            </fieldset>
            <Field label="Max active cases"><input name="maxActiveCases" type="number" min={1} max={50} defaultValue={target?.maxActiveCases ?? 5} /></Field>
          </>
        )}
        {target && <label className="check"><input name="isActive" type="checkbox" defaultChecked={target.isActive} disabled={isSelf} /> Active</label>}
        <ErrorMessage message={error} />
        <button className="primary" disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
      </form>
    </Modal>
  )
}

export default function Users() {
  const { data, error, loading, reload } = useResource(api.users)
  const [editing, setEditing] = useState<ManagedUser | 'new' | null>(null)
  const action = useAction()
  useLive(reload)
  const done = () => { setEditing(null); reload() }
  const deactivate = (user: ManagedUser) => action.run(async () => { await api.updateUser(user._id, { isActive: !user.isActive }); reload() })

  return (
    <section>
      <header className="page-head">
        <h1>User management</h1>
        <button className="primary" onClick={() => setEditing('new')}>Create user</button>
      </header>
      <ErrorMessage message={action.error} />
      <Resource loading={loading} error={error}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Specialties</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data?.map((user) => (
                <tr key={user._id} className={user.isActive ? '' : 'inactive'}>
                  <td>{user.name}</td>
                  <td>{user.email}</td>
                  <td><Badge value={`L${user.level} · ${LEVEL_TITLES[user.level]}`} kind="level" /></td>
                  <td>{user.specialties?.join(', ') || '—'}</td>
                  <td>{user.isActive ? user.availability ?? 'active' : 'deactivated'}</td>
                  <td className="actions">
                    <button onClick={() => setEditing(user)}>Edit</button>
                    <button disabled={action.pending} onClick={() => deactivate(user)}>{user.isActive ? 'Deactivate' : 'Activate'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Resource>
      {editing && <UserModal target={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onDone={done} />}
    </section>
  )
}
