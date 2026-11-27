import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { PasswordInput } from '../components/PasswordInput'
import { consumePendingReturnUrl, THIENBAO_BRAND, THIENBAO_SLOGAN } from '../lib/hostScope'
import { errorMessage } from '../lib/format'
import { useTbAuth } from './auth'
import { ThienBaoLogo } from './ThienBaoLogo'

export function ThienBaoLoginPage() {
  const { session, loading, signIn, signUp } = useTbAuth()
  const location = useLocation()

  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  if (loading) return <p className="center muted">Đang tải…</p>
  if (session) {
    const from = (location.state as { from?: string } | null)?.from ?? consumePendingReturnUrl() ?? '/'
    return <Navigate to={from} replace />
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)
    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail || !password) return setError('Vui lòng nhập đầy đủ email và mật khẩu')
    if (mode === 'register' && !fullName.trim()) return setError('Vui lòng nhập họ tên của bạn')
    if (password.length < 6) return setError('Mật khẩu phải có ít nhất 6 ký tự')

    setSubmitting(true)
    try {
      if (mode === 'login') {
        await signIn(cleanEmail, password)
      } else {
        await signUp(fullName.trim(), cleanEmail, password)
        setInfo('Đã gửi đăng ký tài khoản. Quản lý xưởng sẽ duyệt tài khoản của bạn.')
      }
    } catch (err) {
      const msg = errorMessage(err)
      setError(msg === 'Invalid login credentials' ? 'Sai email hoặc mật khẩu' : msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login">
      <div className="card form login-card">
        <div className="login-brand">
          <ThienBaoLogo size={52} />
          <div>
            <h1>{THIENBAO_BRAND}</h1>
            <p className="muted">{THIENBAO_SLOGAN}</p>
          </div>
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {info && <p className="success">{info}</p>}

        <form onSubmit={onSubmit} className="login-email-form">
          {mode === 'register' && (
            <label>
              Họ và tên nhân viên
              <input
                type="text"
                placeholder="Nguyễn Văn A"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </label>
          )}
          <label>
            Email đăng nhập
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Mật khẩu
            <PasswordInput
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? 'Đang xử lý…' : mode === 'login' ? 'Đăng nhập' : 'Đăng ký tài khoản nhân viên'}
          </button>
        </form>

        <p className="login-hint muted" style={{ textAlign: 'center', marginTop: 12 }}>
          {mode === 'login' ? (
            <>
              Chưa có tài khoản nhân viên?{' '}
              <button type="button" className="link" onClick={() => { setError(null); setMode('register') }}>
                Đăng ký chờ duyệt
              </button>
            </>
          ) : (
            <>
              Đã có tài khoản?{' '}
              <button type="button" className="link" onClick={() => { setError(null); setMode('login') }}>
                Quay lại đăng nhập
              </button>
            </>
          )}
        </p>
      </div>
    </main>
  )
}
