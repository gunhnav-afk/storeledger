import { Suspense, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { THIENBAO_BRAND } from '../lib/hostScope'
import { useTheme, type ThemeMode } from '../lib/theme'
import { ErrorPage } from '../components/ErrorPage'
import { Icon, type IconName } from '../components/Icon'
import { useTbAuth } from './auth'
import { ThienBaoLogo } from './ThienBaoLogo'
import { useWorkshop } from './workshop'

type NavItem = { to: string; label: string; icon: IconName; managerOnly?: boolean }

const NAV_ITEMS: NavItem[] = [
  { to: '/attendance', label: 'Quản lý chấm công', icon: 'calendar', managerOnly: true },
  { to: '/checkin', label: 'Quét QR chấm công', icon: 'qr' },
  { to: '/orders', label: 'Mã hàng xưởng', icon: 'product' },
  { to: '/workers', label: 'Nhân sự', icon: 'staff', managerOnly: true },
]

const THEME_CHOICES: { value: ThemeMode; label: string; icon: IconName }[] = [
  { value: 'light', label: 'Sáng', icon: 'sun' },
  { value: 'dark', label: 'Tối', icon: 'moon' },
  { value: 'system', label: 'Theo máy', icon: 'monitor' },
]

function initials(name: string): string {
  const words = name.trim().split(/\s+/)
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase()
}

export function ThienBaoLayout() {
  const { profile, isSuperAdmin, signOut } = useTbAuth()
  const { isManager, loading, error } = useWorkshop()
  const navigate = useNavigate()
  const topbarRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = topbarRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const root = document.documentElement
    const sync = () => root.style.setProperty('--topbar-h', `${el.offsetHeight}px`)
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => {
      ro.disconnect()
      root.style.removeProperty('--topbar-h')
    }
  }, [])

  const displayName = profile?.full_name || (isSuperAdmin ? 'Chủ xưởng' : isManager ? 'Quản lý xưởng' : 'Nhân viên')
  const roleLabel = isSuperAdmin ? 'Chủ xưởng' : isManager ? 'Quản lý' : profile?.department || 'Nhân viên'
  const visibleItems = NAV_ITEMS.filter((item) => !item.managerOnly || isManager)

  return (
    <div className="layout">
      <header className="topbar" ref={topbarRef}>
        <div className="topbar-inner">
          <div className="topbar-row">
            <span className="brand">
              <ThienBaoLogo size={36} />
              <span className="brand-text">{THIENBAO_BRAND}</span>
              <span className="tb-subbrand">Xưởng may</span>
            </span>
            <span className="spacer" />
            <ThienBaoUserMenu
              name={displayName}
              roleLabel={roleLabel}
              onSignOut={async () => {
                await signOut()
                navigate('/login', { replace: true })
              }}
            />
          </div>
          <nav className="nav">
            {visibleItems.map((item) => (
              <NavLink key={item.to} to={item.to}>
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="content">
        {loading ? (
          <p className="muted">Đang tải dữ liệu xưởng may…</p>
        ) : error ? (
          <ErrorPage code={403} title="Không tải được cấu hình xưởng" message={error} />
        ) : (
          <Suspense fallback={<p className="muted">Đang tải…</p>}>
            <Outlet />
          </Suspense>
        )}
      </main>
    </div>
  )
}

function ThienBaoUserMenu({
  name,
  roleLabel,
  onSignOut,
}: {
  name: string
  roleLabel: string
  onSignOut: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { mode, change } = useTheme()
  const location = useLocation()
  const [lastPath, setLastPath] = useState(location.pathname)

  if (lastPath !== location.pathname) {
    setLastPath(location.pathname)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="user"
        aria-label={name}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="avatar" aria-hidden="true">
          {initials(name)}
        </span>
        <span className="user-text">
          <span className="user-name">{name}</span>
          <span className="user-role">{roleLabel}</span>
        </span>
        <span className={`caret${open ? ' up' : ''}`} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="user-dropdown" role="menu">
          <div className="user-dropdown-head">
            <strong>{name}</strong>
            <span className="muted">{roleLabel}</span>
          </div>
          <NavLink to="/account" role="menuitem" className="user-dropdown-item">
            <Icon name="user" />
            Tài khoản của tôi
          </NavLink>
          <div className="theme-switch" role="radiogroup" aria-label="Giao diện">
            {THEME_CHOICES.map((choice) => (
              <button
                key={choice.value}
                type="button"
                role="radio"
                aria-checked={mode === choice.value}
                className={mode === choice.value ? 'active' : undefined}
                data-mode={choice.value}
                onClick={(e) => change(choice.value, e.currentTarget)}
                title={choice.label}
              >
                <Icon name={choice.icon} size={16} />
                <span>{choice.label}</span>
              </button>
            ))}
          </div>
          <button type="button" role="menuitem" className="user-dropdown-item danger" onClick={onSignOut}>
            <Icon name="logout" />
            Đăng xuất
          </button>
        </div>
      )}
    </div>
  )
}
