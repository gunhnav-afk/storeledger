import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { errorMessage } from '../lib/format'
import { tbSupabase } from './supabase'
import { useTbAuth } from './auth'
import type { TbPublicConfig } from './types'
import { WorkshopContext, type WorkshopState } from './workshop'

type LoadedWorkshop = {
  version: number
  config: TbPublicConfig
  error: string | null
}

export function WorkshopProvider({ children }: { children: ReactNode }) {
  const { isManager: authIsManager } = useTbAuth()
  const [version, setVersion] = useState(0)
  const [loaded, setLoaded] = useState<LoadedWorkshop | null>(null)

  useEffect(() => {
    let cancelled = false
    tbSupabase.rpc('get_workshop_public_config').then(({ data, error }) => {
      if (cancelled) return
      setLoaded({
        version,
        config: error ? null : data,
        error: error ? errorMessage(error) : null,
      })
    })
    return () => {
      cancelled = true
    }
  }, [version])

  const reload = useCallback(() => setVersion((v) => v + 1), [])
  const loading = loaded?.version !== version
  const config = loaded?.config ?? null
  const error = loaded?.error ?? null
  const isManager = Boolean(authIsManager || config?.is_manager)

  const value = useMemo<WorkshopState>(
    () => ({ config, isManager, loading, error, reload }),
    [config, isManager, loading, error, reload],
  )

  return <WorkshopContext.Provider value={value}>{children}</WorkshopContext.Provider>
}
