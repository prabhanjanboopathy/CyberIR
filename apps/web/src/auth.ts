import { createContext, useContext } from 'react'
import type { SessionUser } from './api'

export type AuthState = {
  user: SessionUser
  signOut: () => Promise<void>
  refreshUser: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside the authenticated app')
  return value
}
