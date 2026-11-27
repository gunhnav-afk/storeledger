import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { TbProfile } from './types'

export type TbAuthState = {
  session: Session | null
  profile: TbProfile | null
  loading: boolean
  profileError: boolean
  isManager: boolean
  isSuperAdmin: boolean
  signIn: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signUp: (fullName: string, email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => void
}

export const TbAuthContext = createContext<TbAuthState | null>(null)

export function useTbAuth(): TbAuthState {
  const ctx = useContext(TbAuthContext)
  if (!ctx) throw new Error('useTbAuth phải dùng bên trong ThienBaoAuthProvider')
  return ctx
}
