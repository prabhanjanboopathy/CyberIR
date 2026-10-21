import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { LogOut, ShieldCheck } from 'lucide-react'
import { api, AVAILABILITY, type Availability } from '../api'
import { useAuth } from '../auth'
import { useAction } from '../hooks'
import { onLive } from '../socket'
import { Badge } from './ui'

export type NavItem = { to: string; label: string }

const TOASTS: Record<string, string> = {
  'report.created': 'A new report was submitted',
  'report.unassigned': 'A report has no available engineer and needs assignment',
  'report.updated': 'A case was updated',
  'help-request.created': 'You received a help request',
  'help-request.updated': 'A help request was answered',
  'reassignment-request.created': 'A reassignment request needs review',
  'evidence.created': 'Evidence was added to a case',
}

function useToast() {
  const [toast, setToast] = useState('')
  const timer = useRef<number>(undefined)
  useEffect(() => {
    const stop = onLive((event) => {
      if (!TOASTS[event]) return
      setToast(TOASTS[event])
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setToast(''), 4000)
    })
    return () => { stop(); window.clearTimeout(timer.current) }
  }, [])
  return toast
}

function AvailabilityToggle() {
  const { user, refreshUser } = useAuth()
  const { pending, error, run } = useAction()
  const change = (value: Availability) => run(async () => { await api.setAvailability(value); await refreshUser() })

  return (
    <label className="availability" title={error}>
      <span className={`dot ${user.availability}`} />
      <select value={user.availability} disabled={pending} onChange={(event) => change(event.target.value as Availability)} aria-label="Availability">
        {AVAILABILITY.map((value) => <option key={value}>{value}</option>)}
      </select>
    </label>
  )
}

export default function Layout({ nav }: { nav: NavItem[] }) {
  const { user, signOut } = useAuth()
  const toast = useToast()

  return (
    <div className="shell">
      <header className="topbar">
        <strong className="brand"><ShieldCheck size={20} /> CyberIR</strong>
        <div className="topbar-user">
          {user.level === 1 && <AvailabilityToggle />}
          <span>{user.name}</span>
          <Badge value={`L${user.level} · ${user.title}`} kind="level" />
          <button className="link" onClick={signOut}><LogOut size={16} /> Sign out</button>
        </div>
      </header>
      <nav className="sidebar" aria-label="Main">
        {nav.map((item) => <NavLink key={item.to} to={item.to} end>{item.label}</NavLink>)}
      </nav>
      <main className="content"><Outlet /></main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
