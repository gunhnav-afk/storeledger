// Kiểu dữ liệu cơ sở dữ liệu độc lập 100% của Thiên Bảo Clothes (project zfawfaqqvfqzydnhrhkq)

export type TbRole = 'super_admin' | 'manager' | 'staff'
export type TbStatus = 'pending' | 'approved' | 'rejected'
export type TbDepartment = 'Cắt' | 'May' | 'Ủi' | 'Đóng gói' | 'Phụ xưởng' | 'Quản lý'
export type TbOrderStatus = 'pending' | 'cutting' | 'sewing' | 'finishing' | 'completed' | 'cancelled'

export type TbProfile = {
  id: string
  email: string | null
  full_name: string | null
  role: TbRole
  status: TbStatus
  worker_code: string | null
  department: TbDepartment
  phone: string | null
  note: string | null
  created_at: string
}

export type TbWorkshopSettings = {
  id: number
  qr_token: string
  workshop_address: string | null
  latitude: number | null
  longitude: number | null
  allowed_radius_m: number
  max_gps_accuracy_m: number
  shift_start: string
  shift_end: string
  break_start: string
  break_end: string
  updated_at: string
}

export type TbPublicConfig = {
  workshop_address: string | null
  latitude: number | null
  longitude: number | null
  allowed_radius_m: number
  max_gps_accuracy_m: number
  shift_start: string
  shift_end: string
  break_start: string
  break_end: string
  is_manager: boolean
} | null

export type TbAttendanceLog = {
  id: string
  user_id: string
  work_date: string
  check_in_at: string
  check_out_at: string | null
  check_in_lat: number | null
  check_in_lng: number | null
  check_in_distance_m: number | null
  check_out_lat: number | null
  check_out_lng: number | null
  check_out_distance_m: number | null
  worked_minutes: number
  source: 'qr_gps' | 'manual'
  note: string | null
  adjusted_by: string | null
  created_at: string
}

export type TbProductionOrder = {
  id: string
  order_code: string
  style_name: string
  customer_name: string | null
  planned_qty: number
  completed_qty: number
  status: TbOrderStatus
  received_date: string
  due_date: string | null
  note: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type TbStaffRow = {
  user_id: string
  email: string
  full_name: string | null
  role: TbRole
  status: TbStatus
  worker_code: string | null
  department: TbDepartment
  phone: string | null
  note: string | null
  last_sign_in_at: string | null
}

export type TbQrAttendanceResult = {
  id: string
  action: 'check_in' | 'check_out'
  timestamp: string
  distance_m: number
  worked_minutes: number
}

export type ThienBaoDatabase = {
  public: {
    Tables: {
      profiles: {
        Row: TbProfile
        Insert: never
        Update: { full_name?: string | null }
        Relationships: []
      }
      workshop_settings: {
        Row: TbWorkshopSettings
        Insert: Partial<TbWorkshopSettings> & { id?: number }
        Update: Partial<TbWorkshopSettings>
        Relationships: []
      }
      attendance_logs: {
        Row: TbAttendanceLog
        Insert: never
        Update: never
        Relationships: []
      }
      production_orders: {
        Row: TbProductionOrder
        Insert: {
          order_code: string
          style_name: string
          customer_name?: string | null
          planned_qty: number
          completed_qty?: number
          status?: TbOrderStatus
          received_date?: string
          due_date?: string | null
          note?: string | null
        }
        Update: Partial<Omit<TbProductionOrder, 'id' | 'created_at'>>
        Relationships: []
      }
    }
    Views: Record<never, never>
    Functions: {
      is_super_admin: { Args: Record<never, never>; Returns: boolean }
      is_manager: { Args: Record<never, never>; Returns: boolean }
      is_approved_member: { Args: Record<never, never>; Returns: boolean }
      get_workshop_public_config: { Args: Record<never, never>; Returns: TbPublicConfig }
      rotate_workshop_qr: { Args: Record<never, never>; Returns: string }
      submit_qr_attendance: {
        Args: { p_qr_token: string; p_lat: number; p_lng: number; p_accuracy_m?: number | null }
        Returns: TbQrAttendanceResult
      }
      admin_upsert_attendance: {
        Args: {
          p_attendance_id: string | null
          p_user_id: string
          p_work_date: string
          p_check_in_at: string
          p_check_out_at: string | null
          p_note: string | null
        }
        Returns: string
      }
      admin_delete_attendance: { Args: { p_attendance_id: string }; Returns: undefined }
      workshop_list_staff: { Args: Record<never, never>; Returns: TbStaffRow[] }
      workshop_approve_user: {
        Args: {
          p_user_id: string
          p_role?: TbRole
          p_department?: TbDepartment
          p_worker_code?: string | null
          p_phone?: string | null
        }
        Returns: undefined
      }
      workshop_reject_user: { Args: { p_user_id: string }; Returns: undefined }
      workshop_update_worker: {
        Args: {
          p_user_id: string
          p_full_name: string | null
          p_role: TbRole
          p_worker_code: string | null
          p_department: TbDepartment
          p_phone: string | null
          p_note: string | null
        }
        Returns: undefined
      }
    }
    Enums: Record<never, never>
    CompositeTypes: Record<never, never>
  }
}
