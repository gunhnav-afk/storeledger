import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { DEFAULT_MASTER_ADMIN_EMAIL } from '../lib/brand'
import { tbSupabase } from './supabase'
import { TbAuthContext, type TbAuthState } from './auth'
import type { TbProfile } from './types'

const MASTER_EMAIL = (import.meta.env.VITE_MASTER_ADMIN_EMAIL || DEFAULT_MASTER_ADMIN_EMAIL).trim().toLowerCase()

export function ThienBaoAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [loaded, setLoaded] = useState<{ userId: string; version: number; profile: TbProfile | null; error: boolean } | null>(
    null,
  )
  const [profileVersion, setProfileVersion] = useState(0)

  useEffect(() => {
    tbSupabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setSessionReady(true)
    })
    const { data } = tbSupabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setSessionReady(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id ?? null

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    tbSupabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
      .then(
        ({ data, error }) => {
          if (!cancelled) setLoaded({ userId, version: profileVersion, profile: data, error: Boolean(error) })
        },
        () => {
          if (!cancelled) setLoaded({ userId, version: profileVersion, profile: null, error: true })
        },
      )
    return () => {
      cancelled = true
    }
  }, [userId, profileVersion])

  const isCurrentLoad = userId !== null && loaded?.userId === userId && loaded.version === profileVersion
  const profile = isCurrentLoad ? loaded.profile : null
  const profileError = isCurrentLoad && loaded.error
  const loading = !sessionReady || (userId !== null && !isCurrentLoad)

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await tbSupabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const signUp = useCallback(async (fullName: string, email: string, password: string) => {
    const { error } = await tbSupabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await tbSupabase.auth.signOut()
    if (error) throw error
  }, [])

  const refreshProfile = useCallback(() => setProfileVersion((v) => v + 1), [])

  const isSuperAdmin =
    ((profile?.role === 'super_admin' ||
      (Boolean(MASTER_EMAIL) && profile?.email?.toLowerCase() === MASTER_EMAIL)) &&
      profile?.status === 'approved') ||
    false

  const isManager =
    isSuperAdmin || (profile?.role === 'manager' && profile?.status === 'approved') || false

  const value = useMemo<TbAuthState>(
    () => ({
      session,
      profile,
      loading,
      profileError,
      isManager,
      isSuperAdmin,
      signIn,
      signUp,
      signOut,
      refreshProfile,
    }),
    [session, profile, loading, profileError, isManager, isSuperAdmin, signIn, signUp, signOut, refreshProfile],
  )

  return <TbAuthContext.Provider value={value}>{children}</TbAuthContext.Provider>
}
