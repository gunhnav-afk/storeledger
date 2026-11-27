import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { PasswordInput } from '../components/PasswordInput'
import { consumePendingReturnUrl, THIENBAO_BRAND, THIENBAO_SLOGAN } from '../lib/hostScope'
import { errorMessage } from '../lib/format'
import { useTbAuth } from './auth'
import { ThienBaoLogo } from './ThienBaoLogo'

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  )
}

export function ThienBaoLoginPage() {
  const { session, loading, signIn, signInWithGoogle, signUp } = useTbAuth()
  const location = useLocation()

  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [googleLoading, setGoogleLoading] = useState(false)
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

  const onGoogleClick = async () => {
    setError(null)
    setInfo(null)
    setGoogleLoading(true)
    try {
      await signInWithGoogle()
    } catch (err) {
      setGoogleLoading(false)
      const msg = errorMessage(err)
      setError(
        /provider is not enabled/i.test(msg)
          ? 'Chức năng Đăng nhập Google cần bật Google Provider trên project Supabase ThienBaoClothes.'
          : msg,
      )
    }
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

        <button
          type="button"
          className="btn-google"
          disabled={googleLoading}
          onClick={onGoogleClick}
        >
          <GoogleIcon />
          <span>{googleLoading ? 'Đang chuyển tới Google…' : 'Đăng nhập bằng Google'}</span>
        </button>

        <p className="login-hint muted">
          Đăng nhập nhanh với tài khoản Google. Nhân viên mới đăng nhập lần đầu sẽ tự động vào hàng chờ để quản lý xưởng duyệt.
        </p>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {info && <p className="success">{info}</p>}

        <div className="login-divider">
          <span>hoặc</span>
        </div>

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
            {submitting ? 'Đang xử lý…' : mode === 'login' ? 'Đăng nhập' : 'Đăng ký bằng Email'}
          </button>
        </form>

        <p className="login-hint muted" style={{ textAlign: 'center', marginTop: 10 }}>
          {mode === 'login' ? (
            <>
              Không dùng Google?{' '}
              <button
                type="button"
                className="link"
                onClick={() => {
                  setError(null)
                  setMode('register')
                }}
              >
                Đăng ký bằng Email chờ duyệt
              </button>
            </>
          ) : (
            <>
              Đã có tài khoản?{' '}
              <button
                type="button"
                className="link"
                onClick={() => {
                  setError(null)
                  setMode('login')
                }}
              >
                Quay lại đăng nhập
              </button>
            </>
          )}
        </p>
      </div>
    </main>
  )
}
