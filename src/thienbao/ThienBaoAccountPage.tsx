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
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPass, setSavingPass] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const saveName = async () => {
    if (!session) return
    const trimmed = fullName.trim()
    if (!trimmed) return setErr('Vui lòng nhập họ và tên')
    setErr(null)
    setSavingName(true)
    const { error } = await tbSupabase.from('profiles').update({ full_name: trimmed }).eq('id', session.user.id)
    setSavingName(false)
    if (error) return setErr(errorMessage(error))
    refreshProfile()
    toast.success('Đã lưu thông tin cá nhân')
  }

  const savePassword = async () => {
    if (newPassword.length < 6) return setErr('Mật khẩu mới cần ít nhất 6 ký tự')
    if (newPassword !== confirmPassword) return setErr('Mật khẩu nhập lại chưa khớp')
    setErr(null)
    setSavingPass(true)
    const { error } = await tbSupabase.auth.updateUser({ password: newPassword })
    setSavingPass(false)
    if (error) return setErr(errorMessage(error))
    setNewPassword('')
    setConfirmPassword('')
    toast.success('Đã cập nhật mật khẩu')
  }

  return (
    <section>
      <div className="tb-page-head">
        <div className="tb-page-title-group">
          <h1>Tài khoản của tôi</h1>
          <p className="tb-page-sub">Họ tên hiển thị và mật khẩu đăng nhập</p>
        </div>
      </div>

      {err && (
        <p className="error" style={{ marginBottom: 16 }}>
          {err}
        </p>
      )}

      <div className="tb-account-grid">
        <div className="card tb-qr-card">
          <div className="tb-card-head">
            <div>
              <h2>Thông tin cá nhân</h2>
              <p className="tb-card-desc">Tên hiển thị dùng trên bảng chấm công và hồ sơ xưởng</p>
            </div>
          </div>

          <div className="form" style={{ flex: 1 }}>
            <label>
              <span className="tb-field-label">Email đăng nhập</span>
              <input type="email" value={profile?.email ?? session?.user.email ?? ''} disabled />
            </label>
            <label>
              <span className="tb-field-label">Tổ chuyên môn</span>
              <input type="text" value={profile?.department ?? '—'} disabled />
            </label>
            <label>
              <span className="tb-field-label">Họ và tên</span>
              <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </label>
          </div>

          <div className="tb-card-foot">
            <span className="muted" style={{ fontSize: 12.5 }}>
              Tổ chuyên môn do quản lý xưởng phân công
            </span>
            <button type="button" className="primary" disabled={savingName} onClick={saveName}>
              {savingName ? 'Đang lưu…' : 'Lưu họ tên'}
            </button>
          </div>
        </div>

        <div className="card tb-qr-card">
          <div className="tb-card-head">
            <div>
              <h2>Đổi mật khẩu</h2>
              <p className="tb-card-desc">Thiết lập mật khẩu mới để đăng nhập trực tiếp bằng email</p>
            </div>
          </div>

          <div className="form" style={{ flex: 1 }}>
            <label>
              <span className="tb-field-label">Mật khẩu mới</span>
              <PasswordInput
                autoComplete="new-password"
                placeholder="Ít nhất 6 ký tự"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </label>
            <label>
              <span className="tb-field-label">Nhập lại mật khẩu mới</span>
              <PasswordInput
                autoComplete="new-password"
                placeholder="Nhập lại mật khẩu"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </label>
          </div>

          <div className="tb-card-foot">
            <span className="muted" style={{ fontSize: 12.5 }}>
              Có hiệu lực ngay sau khi lưu
            </span>
            <button type="button" className="primary" disabled={savingPass} onClick={savePassword}>
              {savingPass ? 'Đang lưu…' : 'Cập nhật mật khẩu'}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
