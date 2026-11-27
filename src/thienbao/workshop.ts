import { createContext, useContext } from 'react'
import type { TbPublicConfig } from './types'

export type WorkshopState = {
  config: TbPublicConfig
  isManager: boolean
  loading: boolean
  error: string | null
  reload: () => void
}

export const WorkshopContext = createContext<WorkshopState | null>(null)

export function useWorkshop(): WorkshopState {
  const ctx = useContext(WorkshopContext)
  if (!ctx) throw new Error('useWorkshop phải dùng bên trong WorkshopProvider')
  return ctx
}
