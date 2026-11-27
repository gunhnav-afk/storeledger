import { lazy, type ReactNode } from 'react'
import { Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { savePendingReturnUrl } from '../lib/hostScope'
import { ErrorPage } from '../components/ErrorPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { ThienBaoAuthProvider } from './ThienBaoAuthProvider'
import { useTbAuth } from './auth'
import { ThienBaoLoginPage } from './ThienBaoLoginPage'
import { WorkshopProvider } from './WorkshopContext'
import { useWorkshop } from './workshop'
import { ThienBaoLayout } from './ThienBaoLayout'
import './thienbao.css'

const ThienBaoAccountPage = lazy(() =>
  import('./ThienBaoAccountPage').then((m) => ({ default: m.ThienBaoAccountPage })),
)
const CheckinPage = lazy(() => import('./pages/CheckinPage').then((m) => ({ default: m.CheckinPage })))
const AttendanceAdminPage = lazy(() =>
  import('./pages/AttendanceAdminPage').then((m) => ({ default: m.AttendanceAdminPage })),
)
const OrdersPage = lazy(() => import('./pages/OrdersPage').then((m) => ({ default: m.OrdersPage })))
const WorkersPage = lazy(() => import('./pages/WorkersPage').then((m) => ({ default: m.WorkersPage })))

function RequireTbAuth() {
  const { session, profile, loading, profileError, refreshProfile, signOut } = useTbAuth()
  const location = useLocation()

  if (loading) return <p className="center muted">Đang tải…</p>
  if (!session) {
    const fullTarget = location.pathname + location.search
    savePendingReturnUrl(fullTarget)
    if (location.pathname === '/' || location.pathname === '/checkin') {
      return <Navigate to="/login" state={{ from: fullTarget }} replace />
    }
    return (
      <div className="error-screen">
        <ErrorPage
          code={401}
          title="Bạn chưa đăng nhập"
          message="Vui lòng đăng nhập vào Thiên Bảo Clothes để tiếp tục."
        >
          <Link to="/login" state={{ from: fullTarget }} className="button primary">
            Đăng nhập
          </Link>
        </ErrorPage>
      </div>
    )
  }

  if (profileError) {
    return (
      <div className="error-screen">
        <ErrorPage code={403} title="Không tải được hồ sơ nhân viên" message="Vui lòng thử tải lại.">
          <button type="button" className="primary" onClick={refreshProfile}>
            Tải lại
          </button>
        </ErrorPage>
      </div>
    )
  }

  if (!profile || profile.status === 'pending') {
    return (
      <div className="error-screen">
        <ErrorPage
          code={403}
          title="Tài khoản đang chờ duyệt"
          message="Tài khoản của bạn đã được ghi nhận và đang chờ Quản lý xưởng Thiên Bảo Clothes phê duyệt."
        >
          <button type="button" onClick={() => signOut()}>
            Đăng xuất
          </button>
        </ErrorPage>
      </div>
    )
  }

  if (profile.status === 'rejected') {
    return (
      <div className="error-screen">
        <ErrorPage
          code={403}
          title="Tài khoản đã khoá"
          message="Tài khoản này hiện không còn quyền truy cập xưởng Thiên Bảo Clothes."
        >
          <button type="button" onClick={() => signOut()}>
            Đăng xuất
          </button>
        </ErrorPage>
      </div>
    )
  }

  return <Outlet />
}

function WorkshopScope() {
  const { session } = useTbAuth()
  return (
    <WorkshopProvider key={session?.user.id}>
      <ThienBaoLayout />
    </WorkshopProvider>
  )
}

function HomeRedirect() {
  const { isManager } = useWorkshop()
  return <Navigate to={isManager ? '/attendance' : '/checkin'} replace />
}

function RequireManager({ children }: { children: ReactNode }) {
  const { isManager } = useWorkshop()
  if (!isManager) {
    return (
      <ErrorPage
        code={403}
        title="Trang chỉ dành cho Quản lý xưởng"
        message="Tài khoản nhân viên chỉ dùng mục Quét QR chấm công và xem Mã hàng xưởng."
      />
    )
  }
  return children
}

export function ThienBaoApp() {
  return (
    <ThienBaoAuthProvider>
      <div className="tb-root">
        <Routes>
          <Route path="/login" element={<ThienBaoLoginPage />} />
          <Route element={<RequireTbAuth />}>
            <Route element={<WorkshopScope />}>
              <Route index element={<HomeRedirect />} />
              <Route path="checkin" element={<CheckinPage />} />
              <Route
                path="attendance/*"
                element={
                  <RequireManager>
                    <AttendanceAdminPage />
                  </RequireManager>
                }
              />
              <Route path="orders" element={<OrdersPage />} />
              <Route
                path="workers"
                element={
                  <RequireManager>
                    <WorkersPage />
                  </RequireManager>
                }
              />
              <Route path="account" element={<ThienBaoAccountPage />} />
            </Route>
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </div>
    </ThienBaoAuthProvider>
  )
}
