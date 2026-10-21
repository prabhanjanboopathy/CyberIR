import { useEffect, type ReactNode } from 'react'

const slug = (value: string) => value.toLowerCase().replace(/[^a-z]+/g, '-')

export const Badge = ({ value, kind }: { value: string; kind: 'status' | 'severity' | 'level' }) => (
  <span className={`badge ${kind}-${slug(value)}`}>{value}</span>
)

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <p className="state" role="status">{label}</p>
}

export function ErrorMessage({ message }: { message?: string }) {
  return message ? <p className="state error" role="alert">{message}</p> : null
}

export function Resource({ loading, error, children }: { loading: boolean; error?: string; children: ReactNode }) {
  if (error) return <ErrorMessage message={error} />
  return loading ? <Loading /> : children
}

export const Empty = ({ children }: { children: ReactNode }) => <p className="state empty">{children}</p>

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error && <small className="field-error">{error}</small>}
    </label>
  )
}

export function ProgressBar({ value }: { value: number }) {
  return <div className="progress" title={`${value}%`}><i style={{ width: `${value}%` }} /></div>
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header><h2>{title}</h2><button className="link" onClick={onClose} aria-label="Close">✕</button></header>
        {children}
      </div>
    </div>
  )
}
