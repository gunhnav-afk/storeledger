import { createClient } from '@supabase/supabase-js'
import type { ThienBaoDatabase } from './types'

// Cụm Supabase độc lập dành riêng cho Thiên Bảo Clothes (tách biệt hoàn toàn với DB Sổ Xanh)
export const THIENBAO_SUPABASE_URL =
  import.meta.env.VITE_THIENBAO_SUPABASE_URL || 'https://zfawfaqqvfqzydnhrhkq.supabase.co'

export const THIENBAO_SUPABASE_ANON_KEY =
  import.meta.env.VITE_THIENBAO_SUPABASE_ANON_KEY || 'sb_publishable_YMTCq9DdUV4gFZM6oGcvMA_sGjIEier'

export const tbSupabase = createClient<ThienBaoDatabase>(THIENBAO_SUPABASE_URL, THIENBAO_SUPABASE_ANON_KEY, {
  auth: {
    storageKey: 'thienbao-clothes.auth',
  },
})
