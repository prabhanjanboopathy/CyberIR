import { useCallback, useEffect, useRef, useState } from 'react'
import { onLive } from './socket'

export function useResource<T>(fetcher: () => Promise<T>) {
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState<{ fetcher: () => Promise<T>; data?: T; error?: string }>()

  useEffect(() => {
    let active = true
    fetcher().then(
      (data) => active && setResult({ fetcher, data }),
      (error: Error) => active && setResult({ fetcher, error: error.message }),
    )
    return () => { active = false }
  }, [fetcher, version])

  const reload = useCallback(() => setVersion((value) => value + 1), [])
  const current = result?.fetcher === fetcher ? result : undefined
  return { data: current?.data, error: current?.error, loading: !current, reload }
}

export function useLive(reload: () => void) {
  const latest = useRef(reload)
  useEffect(() => { latest.current = reload })
  useEffect(() => onLive(() => latest.current()), [])
}

export function useAction() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const run = useCallback(async <T,>(action: () => Promise<T>) => {
    setPending(true)
    setError('')
    try {
      return await action()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setPending(false)
    }
  }, [])
  return { pending, error, run }
}
