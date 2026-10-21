import { lazy, Suspense, useEffect, useMemo, useState, type ReactElement } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { api, clearTokens, hasSession, logout, setSessionExpiredHandler, type SessionUser } from './api'
import { AuthContext } from './auth'
import Layout from './components/Layout'
import { Loading } from './components/ui'
import { closeSocket, openSocket } from './socket'
import AuditLog from './pages/AuditLog'
import HelpInbox from './pages/HelpInbox'
import Login from './pages/Login'
import Reassignments from './pages/Reassignments'
import ReportDetail from './pages/ReportDetail'
import ReportForm from './pages/ReportForm'
import ReportList from './pages/ReportList'
import Users from './pages/Users'
import Workload from './pages/Workload'

const Dashboard = lazy(() => import('./pages/Dashboard'))

type AppRoute = { path: string; label?: string; min: number; max?: number; element: ReactElement }

const ROUTES: AppRoute[] = [
  { path: '/reports', label: 'My reports', min: 0, max: 0, element: <ReportList mode="mine" /> },
  { path: '/reports/new', label: 'Report an incident', min: 0, max: 0, element: <ReportForm /> },
  { path: '/assignments', label: 'My assignments', min: 1, max: 1, element: <ReportList mode="assigned" /> },
  { path: '/inbox', label: 'Help requests', min: 1, max: 1, element: <HelpInbox /> },
  { path: '/dashboard', label: 'Dashboard', min: 2, element: <Dashboard /> },
  { path: '/cases', label: 'All cases', min: 2, element: <ReportList mode="all" /> },
  { path: '/reassignments', label: 'Reassignment requests', min: 2, element: <Reassignments /> },
  { path: '/audit', label: 'Audit log', min: 2, element: <AuditLog /> },
  { path: '/workload', label: 'Engineer workload', min: 3, element: <Workload /> },
  { path: '/users', label: 'User management', min: 3, element: <Users /> },
  { path: '/reports/:id', min: 0, element: <ReportDetail /> },
]

const homeFor = (level: number) => (level === 0 ? '/reports' : level === 1 ? '/assignments' : '/dashboard')

export default function App() {
  const [user, setUser] = useState<SessionUser | null | undefined>(hasSession() ? undefined : null)

  useEffect(() => {
    setSessionExpiredHandler(() => { clearTokens(); setUser(null) })
    if (hasSession()) api.me().then(setUser, () => { clearTokens(); setUser(null) })
  }, [])

  const signedIn = Boolean(user)
  useEffect(() => {
    if (!signedIn) return
    openSocket()
    return closeSocket
  }, [signedIn])

  const auth = useMemo(() => user && {
    user,
    signOut: async () => { await logout(); setUser(null) },
    refreshUser: async () => setUser(await api.me()),
  }, [user])

  if (user === undefined) return <Loading label="Restoring session…" />
  if (!user || !auth) return <Login onSignedIn={setUser} />

  const allowed = ROUTES.filter((route) => user.level >= route.min && user.level <= (route.max ?? 3))
  const nav = allowed.filter((route) => route.label).map(({ path, label }) => ({ to: path, label: label! }))

  return (
    <AuthContext.Provider value={auth}>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route element={<Layout nav={nav} />}>
            {allowed.map((route) => <Route key={route.path} path={route.path} element={route.element} />)}
            <Route path="*" element={<Navigate to={homeFor(user.level)} replace />} />
          </Route>
        </Routes>
      </Suspense>
    </AuthContext.Provider>
  )
}
