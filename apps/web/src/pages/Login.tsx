import { useState, type FormEvent } from 'react'
import { ShieldCheck } from 'lucide-react'
import { ApiError, demoAccounts, demoLogin, login, type DemoAccount, type SessionUser } from '../api'
import { ErrorMessage, Field } from '../components/ui'
import { useResource } from '../hooks'

const GROUPS = [
  { level: 0, label: 'Reporters' },
  { level: 1, label: 'Cybersecurity Engineers' },
  { level: 2, label: 'Risk Analyst' },
  { level: 3, label: 'Admin' },
]

function QuickSignIn({ disabled, onPick }: { disabled: boolean; onPick: (account: DemoAccount) => void }) {
  const { data } = useResource(demoAccounts)
  if (!data?.length) return null
  return (
    <section className="card quick-signin">
      <h2>Quick sign in (demo)</h2>
      {GROUPS.map(({ level, label }) => (
        <div key={level}>
          <h3>{label}</h3>
          <div className="quick-grid">
            {data.filter((account) => account.level === level).map((account) => (
              <button key={account.email} type="button" disabled={disabled} onClick={() => onPick(account)}>
                <strong>{account.name}</strong>
                <span>{account.email}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}

export default function Login({ onSignedIn }: { onSignedIn: (user: SessionUser) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [needsCode, setNeedsCode] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function signIn(attempt: () => Promise<SessionUser>) {
    setPending(true)
    setError('')
    try {
      onSignedIn(await attempt())
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'MFA_REQUIRED') setNeedsCode(true)
      setError((caught as Error).message)
    } finally {
      setPending(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    return signIn(() => login(email.trim(), password, totpCode.trim() || undefined))
  }

  return (
    <main className="login">
      <div className="login-stack">
        <form className="card login-card" onSubmit={submit}>
          <h1><ShieldCheck size={24} /> Sentinel Ops</h1>
          <p className="muted">Sign in to report and respond to cyber incidents.</p>
          <Field label="Email"><input type="email" required autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
          <Field label="Password"><input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
          {needsCode && <Field label="Authenticator or recovery code"><input required autoComplete="one-time-code" value={totpCode} onChange={(event) => setTotpCode(event.target.value)} /></Field>}
          <ErrorMessage message={error} />
          <button className="primary" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <QuickSignIn disabled={pending} onPick={(account) => signIn(() => demoLogin(account.email))} />
      </div>
    </main>
  )
}
