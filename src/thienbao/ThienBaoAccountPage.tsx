import { useState } from 'react'
import { PasswordInput } from '../components/PasswordInput'
import { useToast } from '../lib/toast'
import { errorMessage } from '../lib/format'
import { tbSupabase } from './supabase'
import { useTbAuth } from './auth'

export function ThienBaoAccountPage() {
  const { profile, session, refreshProfile } = useTbAuth()
  const toast = useToast()

  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [savingName, setSavingName] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [savingPass, setSavingPass] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const saveName = async () => {
    if (!session) return
    const trimmed = fullName.trim()
    if (!trimmed) return setErr('Nhập họ và tên')
    setErr(null)
    setSavingName(true)
    const { error } = await tbSupabase.from('profiles').update({ full_name: trimmed }).eq('id', session.user.id)
    setSavingName(false)
    if (error) return setErr(errorMessage(error))
    refreshProfile()
    toast.success('Đã lưu tên hiển thị')
  }

  const savePassword = async () => {
    if (newPassword.length < 6) return setErr('Mật khẩu mới phải có ít nhất 6 ký tự')
    setErr(null)
    setSavingPass(true)
    const { error } = await tbSupabase.auth.updateUser({ password: newPassword })
    setSavingPass(false)
    if (error) return setErr(errorMessage(error))
    setNewPassword('')
    toast.success('Đã đổi mật khẩu')
  }

  return (
    <section style={{ maxWidth: 540 }}>
      <h1>Tài khoản của tôi</h1>
      {err && <p className="error">{err}</p>}

      <div className="card form" style={{ marginBottom: 16 }}>
        <label>
          Email đăng nhập
          <input type="email" value={profile?.email ?? session?.user.email ?? ''} disabled />
        </label>
        <label>
          Tổ chuyên môn
          <input type="text" value={profile?.department ?? '—'} disabled />
        </label>
        <label>
          Họ và tên
          <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </label>
        <div>
          <button type="button" className="primary" disabled={savingName} onClick={saveName}>
            {savingName ? 'Đang lưu…' : 'Lưu họ tên'}
          </button>
        </div>
      </div>

      <div className="card form">
        <h3 style={{ margin: 0 }}>Đổi mật khẩu</h3>
        <label>
          Mật khẩu mới (ít nhất 6 ký tự)
          <PasswordInput
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </label>
        <div>
          <button type="button" className="primary" disabled={savingPass} onClick={savePassword}>
            {savingPass ? 'Đang lưu…' : 'Cập nhật mật khẩu'}
          </button>
        </div>
      </div>
    </section>
  )
}
