import { useEffect, useState } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { useToast } from '../../lib/toast'
import { useConfirm, usePrompt } from '../../lib/confirm'
import { PasswordInput } from '../../components/PasswordInput'
import { errorMessage } from '../../lib/format'
import { tbSupabase } from '../supabase'
import { useTbAuth } from '../auth'
import type { TbDepartment, TbRole, TbStaffRow } from '../types'

const DEPARTMENTS: TbDepartment[] = ['Cắt', 'May', 'Ủi', 'Đóng gói', 'Phụ xưởng', 'Quản lý']
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type CreateUserRes = { ok?: boolean; user_id?: string; error?: string }

async function invokeTbAdminUsers(body: Record<string, unknown>): Promise<CreateUserRes> {
  const { data, error } = await tbSupabase.functions.invoke('admin-users', { body })
  if (!error) return (data as CreateUserRes) ?? { ok: true }
  if (error instanceof FunctionsHttpError) {
    const payload = await error.context.json().catch(() => null)
    if (payload?.error) throw new Error(payload.error)
  }
  throw error
}

export function WorkersPage() {
  const { session, isSuperAdmin } = useTbAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const prompt = usePrompt()

  const [list, setList] = useState<{ rows: TbStaffRow[]; error: string | null } | null>(null)
  const [version, setVersion] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const [createForm, setCreateForm] = useState({
    fullName: '',
    email: '',
    password: '',
    workerCode: '',
    department: 'May' as TbDepartment,
    role: 'staff' as TbRole,
    phone: '',
  })
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)

  const [editing, setEditing] = useState<{
    userId: string
    fullName: string
    workerCode: string
    department: TbDepartment
    role: TbRole
    phone: string
    note: string
  } | null>(null)

  const [pendingDept, setPendingDept] = useState<Record<string, TbDepartment>>({})

  useEffect(() => {
    let cancelled = false
    tbSupabase.rpc('workshop_list_staff').then(({ data, error }) => {
      if (!cancelled) setList({ rows: data ?? [], error: error ? errorMessage(error) : null })
    })
    return () => {
      cancelled = true
    }
  }, [version])

  const reload = () => setVersion((v) => v + 1)

  const approveToWorkshop = async (row: TbStaffRow) => {
    const dept = pendingDept[row.user_id] ?? 'May'
    setBusyId(row.user_id)
    const { error } = await tbSupabase.rpc('workshop_approve_user', {
      p_user_id: row.user_id,
      p_role: 'staff',
      p_department: dept,
    })
    setBusyId(null)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    toast.success(`Đã duyệt ${row.full_name || row.email} vào tổ ${dept}`)
    reload()
  }

  const lockOrReject = async (row: TbStaffRow) => {
    const ok = await confirm({
      title: 'Khoá quyền truy cập',
      message: `Khoá quyền truy cập xưởng của ${row.full_name || row.email}?`,
      confirmText: 'Khoá quyền',
      cancelText: 'Đóng',
      danger: true,
    })
    if (!ok) return
    setBusyId(row.user_id)
    const { error } = await tbSupabase.rpc('workshop_reject_user', { p_user_id: row.user_id })
    setBusyId(null)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    toast.success('Đã khoá quyền truy cập')
    reload()
  }

  const createWorkerAccount = async () => {
    setCreateErr(null)
    const fullName = createForm.fullName.trim()
    const email = createForm.email.trim().toLowerCase()
    const password = createForm.password

    if (!fullName) return setCreateErr('Nhập họ tên nhân viên')
    if (!EMAIL_PATTERN.test(email)) return setCreateErr('Email đăng nhập không hợp lệ')
    if (password.length < 6) return setCreateErr('Mật khẩu cần ít nhất 6 ký tự')

    setCreating(true)
    try {
      await invokeTbAdminUsers({
        action: 'create',
        full_name: fullName,
        email,
        password,
        role: createForm.role,
        department: createForm.department,
        worker_code: createForm.workerCode.trim() || null,
        phone: createForm.phone.trim() || null,
      })
      toast.success(`Đã tạo tài khoản cho ${fullName}`)
      setCreateForm({
        fullName: '',
        email: '',
        password: '',
        workerCode: '',
        department: 'May',
        role: 'staff',
        phone: '',
      })
      setCreateOpen(false)
      reload()
    } catch (e) {
      setCreateErr(errorMessage(e))
    } finally {
      setCreating(false)
    }
  }

  const saveWorkerMeta = async () => {
    if (!editing) return
    setBusyId(editing.userId)
    const { error } = await tbSupabase.rpc('workshop_update_worker', {
      p_user_id: editing.userId,
      p_full_name: editing.fullName.trim() || null,
      p_role: editing.role,
      p_worker_code: editing.workerCode.trim() || null,
      p_department: editing.department,
      p_phone: editing.phone.trim() || null,
      p_note: editing.note.trim() || null,
    })
    setBusyId(null)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    toast.success('Đã cập nhật hồ sơ nhân sự')
    setEditing(null)
    reload()
  }

  const resetPassword = async (row: TbStaffRow) => {
    const newPass = await prompt({
      title: `Đổi mật khẩu cho ${row.full_name || row.email}`,
      message: 'Nhập mật khẩu mới (ít nhất 6 ký tự):',
      placeholder: 'Mật khẩu mới…',
      type: 'password',
      confirmText: 'Lưu mật khẩu',
      cancelText: 'Đóng',
      minLength: 6,
      required: true,
    })
    if (!newPass) return
    setBusyId(row.user_id)
    try {
      await invokeTbAdminUsers({ action: 'set_password', user_id: row.user_id, password: newPass })
      toast.success(`Đã đổi mật khẩu cho ${row.full_name || row.email}`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  const pendingRows = (list?.rows ?? []).filter((r) => r.status === 'pending')
  const activeRows = (list?.rows ?? []).filter((r) => r.status !== 'pending')

  return (
    <section>
      <div className="tb-page-head">
        <div className="tb-page-title-group">
          <h1>Nhân sự xưởng may</h1>
          <p className="tb-page-sub">Duyệt tài khoản mới và phân tổ nhân sự xưởng</p>
        </div>
        <button type="button" className="primary" onClick={() => setCreateOpen((o) => !o)}>
          <span>{createOpen ? 'Ẩn biểu mẫu' : 'Thêm nhân viên'}</span>
        </button>
      </div>

      {pendingRows.length > 0 && (
        <div className="tb-approval-box">
          <div className="tb-toolbar" style={{ marginBottom: 4 }}>
            <h2>
              Tài khoản chờ duyệt
              <span className="badge badge-low">{pendingRows.length}</span>
            </h2>
          </div>
          <p className="tb-card-desc">Chọn tổ chuyên môn rồi bấm Duyệt để nhân viên có thể quét QR chấm công</p>
          <div className="tb-approval-list">
            {pendingRows.map((u) => (
              <div key={u.user_id} className="tb-approval-row">
                <div>
                  <strong style={{ display: 'block', color: 'var(--text-h)' }}>
                    {u.full_name || '(chưa đặt tên)'}
                  </strong>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {u.email}
                  </span>
                </div>
                <div className="tb-inline-actions">
                  <select
                    aria-label="Chọn tổ chuyên môn"
                    value={pendingDept[u.user_id] ?? 'May'}
                    onChange={(e) =>
                      setPendingDept((prev) => ({ ...prev, [u.user_id]: e.target.value as TbDepartment }))
                    }
                  >
                    {DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        Tổ {d}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="primary"
                    disabled={busyId === u.user_id}
                    onClick={() => approveToWorkshop(u)}
                  >
                    Duyệt vào xưởng
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busyId === u.user_id}
                    onClick={() => lockOrReject(u)}
                  >
                    Từ chối
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {createOpen && (
        <div className="card form" style={{ marginBottom: 20 }}>
          <div className="tb-toolbar" style={{ marginBottom: 0 }}>
            <h2>Tạo tài khoản nhân viên</h2>
            <button type="button" className="tb-ghost" onClick={() => setCreateOpen(false)}>
              Đóng
            </button>
          </div>
          <div className="tb-grid-3">
            <label>
              <span className="tb-field-label">Họ và tên</span>
              <input
                type="text"
                placeholder="Nguyễn Văn A"
                value={createForm.fullName}
                onChange={(e) => setCreateForm({ ...createForm, fullName: e.target.value })}
              />
            </label>
            <label>
              <span className="tb-field-label">Email đăng nhập</span>
              <input
                type="email"
                autoComplete="off"
                placeholder="nhanvien@gmail.com"
                value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
              />
            </label>
            <label>
              <span className="tb-field-label">Mật khẩu khởi tạo</span>
              <PasswordInput
                autoComplete="new-password"
                value={createForm.password}
                onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
              />
            </label>
          </div>
          <div className="tb-grid-4">
            <label>
              <span className="tb-field-label">Mã nhân viên</span>
              <input
                type="text"
                placeholder="NV01"
                value={createForm.workerCode}
                onChange={(e) => setCreateForm({ ...createForm, workerCode: e.target.value })}
              />
            </label>
            <label>
              <span className="tb-field-label">Tổ chuyên môn</span>
              <select
                value={createForm.department}
                onChange={(e) => setCreateForm({ ...createForm, department: e.target.value as TbDepartment })}
              >
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="tb-field-label">Vai trò</span>
              <select
                value={createForm.role}
                onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as TbRole })}
              >
                <option value="staff">Nhân viên</option>
                <option value="manager">Quản lý xưởng</option>
              </select>
            </label>
            <label>
              <span className="tb-field-label">Số điện thoại</span>
              <input
                type="tel"
                placeholder="09xx…"
                value={createForm.phone}
                onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
              />
            </label>
          </div>
          {createErr && <p className="error">{createErr}</p>}
          <div className="tb-inline-actions">
            <button type="button" className="primary" disabled={creating} onClick={createWorkerAccount}>
              {creating ? 'Đang tạo…' : 'Tạo tài khoản'}
            </button>
            <button type="button" onClick={() => setCreateOpen(false)}>
              Huỷ
            </button>
          </div>
        </div>
      )}

      {editing && (
        <div className="card form" style={{ marginBottom: 20 }}>
          <div className="tb-toolbar" style={{ marginBottom: 0 }}>
            <h2>Cập nhật hồ sơ nhân sự</h2>
            <button type="button" className="tb-ghost" onClick={() => setEditing(null)}>
              Đóng
            </button>
          </div>
          <div className="tb-grid-3">
            <label>
              <span className="tb-field-label">Họ và tên</span>
              <input
                type="text"
                value={editing.fullName}
                onChange={(e) => setEditing({ ...editing, fullName: e.target.value })}
              />
            </label>
            <label>
              <span className="tb-field-label">Mã nhân viên</span>
              <input
                type="text"
                placeholder="NV01"
                value={editing.workerCode}
                onChange={(e) => setEditing({ ...editing, workerCode: e.target.value })}
              />
            </label>
            <label>
              <span className="tb-field-label">Số điện thoại</span>
              <input
                type="tel"
                value={editing.phone}
                onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
              />
            </label>
          </div>
          <div className="tb-grid-2">
            <label>
              <span className="tb-field-label">Tổ chuyên môn</span>
              <select
                value={editing.department}
                onChange={(e) => setEditing({ ...editing, department: e.target.value as TbDepartment })}
              >
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="tb-field-label">Vai trò</span>
              <select
                value={editing.role}
                disabled={editing.role === 'super_admin' && !isSuperAdmin}
                onChange={(e) => setEditing({ ...editing, role: e.target.value as TbRole })}
              >
                <option value="staff">Nhân viên</option>
                <option value="manager">Quản lý xưởng</option>
                {isSuperAdmin && <option value="super_admin">Chủ xưởng</option>}
              </select>
            </label>
          </div>
          <label>
            <span className="tb-field-label">Ghi chú tay nghề / ca làm</span>
            <input
              type="text"
              placeholder="Chuyên may vắt sổ, làm ca hành chính…"
              value={editing.note}
              onChange={(e) => setEditing({ ...editing, note: e.target.value })}
            />
          </label>
          <div className="tb-inline-actions">
            <button type="button" className="primary" disabled={busyId === editing.userId} onClick={saveWorkerMeta}>
              Lưu hồ sơ
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              Huỷ
            </button>
          </div>
        </div>
      )}

      {!list ? (
        <div className="tb-empty">Đang tải danh sách nhân sự…</div>
      ) : list.error ? (
        <p className="error">{list.error}</p>
      ) : activeRows.length === 0 ? (
        <div className="tb-empty">Chưa có nhân sự nào trong xưởng</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nhân viên</th>
                <th>Mã NV</th>
                <th>Tổ</th>
                <th>Điện thoại</th>
                <th>Vai trò</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {activeRows.map((u) => {
                const isSelf = u.user_id === session?.user.id
                const isRejected = u.status === 'rejected'
                return (
                  <tr key={u.user_id}>
                    <td>
                      <strong>{u.full_name || '(chưa có tên)'}</strong>
                      <br />
                      <small className="muted">{u.email}</small>
                      {u.note && (
                        <>
                          <br />
                          <small className="muted">{u.note}</small>
                        </>
                      )}
                    </td>
                    <td>{u.worker_code || '—'}</td>
                    <td>{u.department}</td>
                    <td>{u.phone || '—'}</td>
                    <td>
                      {isRejected ? (
                        <span className="badge badge-out">Đã khoá</span>
                      ) : u.role === 'super_admin' ? (
                        <span className="badge tb-badge-role">Chủ xưởng</span>
                      ) : u.role === 'manager' ? (
                        <span className="badge badge-ok">Quản lý xưởng</span>
                      ) : (
                        <span className="muted">Nhân viên</span>
                      )}
                    </td>
                    <td className="actions">
                      {isRejected ? (
                        <button type="button" className="link" onClick={() => approveToWorkshop(u)}>
                          Mở lại quyền
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="link"
                            onClick={() => {
                              setEditing({
                                userId: u.user_id,
                                fullName: u.full_name ?? '',
                                workerCode: u.worker_code ?? '',
                                department: u.department,
                                role: u.role,
                                phone: u.phone ?? '',
                                note: u.note ?? '',
                              })
                              window.scrollTo({ top: 0, behavior: 'smooth' })
                            }}
                          >
                            Sửa
                          </button>
                          {!isSelf && (u.role !== 'super_admin' || isSuperAdmin) && (
                            <>
                              <button type="button" className="link" onClick={() => resetPassword(u)}>
                                Đổi mật khẩu
                              </button>
                              <button type="button" className="link danger" onClick={() => lockOrReject(u)}>
                                Khoá
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
