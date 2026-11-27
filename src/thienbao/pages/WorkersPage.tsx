import { useEffect, useState } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { useToast } from '../../lib/toast'
import { useConfirm, usePrompt } from '../../lib/confirm'
import { PasswordInput } from '../../components/PasswordInput'
import { Icon } from '../../components/Icon'
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
      message: `Khoá quyền truy cập xưởng Thiên Bảo Clothes của ${row.full_name || row.email}?`,
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
    toast.success('Đã cập nhật hồ sơ nhân sự xưởng')
    setEditing(null)
    reload()
  }

  const resetPassword = async (row: TbStaffRow) => {
    const newPass = await prompt({
      title: `Đổi mật khẩu cho ${row.full_name || row.email}`,
      message: 'Nhập mật khẩu mới (tối thiểu 6 ký tự):',
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
      <h1>Nhân sự xưởng may</h1>

      {pendingRows.length > 0 && (
        <div className="approval-queue" style={{ marginBottom: 20 }}>
          <div className="approval-queue-header">
            <h3>
              <Icon name="staff" size={20} />
              Tài khoản mới chờ duyệt vào xưởng
              <span className="approval-queue-count">{pendingRows.length}</span>
            </h3>
          </div>
          <p className="muted">Chọn tổ chuyên môn rồi bấm Duyệt để cấp quyền chấm công tại xưởng.</p>
          <div className="approval-list">
            {pendingRows.map((u) => (
              <div key={u.user_id} className="approval-card">
                <div className="approval-card-top">
                  <div>
                    <strong>{u.full_name || '(chưa đặt tên)'}</strong>
                    <br />
                    <small className="muted">{u.email}</small>
                  </div>
                  <div className="approval-card-actions">
                    <select
                      aria-label="Chọn tổ"
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
              </div>
            ))}
          </div>
        </div>
      )}

      <details className="staff-manual-details" style={{ marginBottom: 20 }}>
        <summary>
          <strong>+ Tạo tài khoản nhân viên mới (Email & Mật khẩu)</strong>
        </summary>
        <div className="card form" style={{ marginTop: 12 }}>
          <div className="row">
            <label>
              Họ và tên
              <input
                type="text"
                placeholder="Nguyễn Văn A"
                value={createForm.fullName}
                onChange={(e) => setCreateForm({ ...createForm, fullName: e.target.value })}
              />
            </label>
            <label>
              Email đăng nhập
              <input
                type="email"
                autoComplete="off"
                placeholder="nhanvien@gmail.com"
                value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
              />
            </label>
            <label>
              Mật khẩu
              <PasswordInput
                autoComplete="new-password"
                value={createForm.password}
                onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
              />
            </label>
          </div>
          <div className="row">
            <label>
              Mã nhân viên
              <input
                type="text"
                placeholder="VD: NV01"
                value={createForm.workerCode}
                onChange={(e) => setCreateForm({ ...createForm, workerCode: e.target.value })}
              />
            </label>
            <label>
              Tổ chuyên môn
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
              Vai trò
              <select
                value={createForm.role}
                onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as TbRole })}
              >
                <option value="staff">Nhân viên</option>
                <option value="manager">Quản lý xưởng</option>
              </select>
            </label>
            <label>
              Số điện thoại
              <input
                type="tel"
                placeholder="09xx..."
                value={createForm.phone}
                onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
              />
            </label>
          </div>
          {createErr && <p className="error">{createErr}</p>}
          <div>
            <button type="button" className="primary" disabled={creating} onClick={createWorkerAccount}>
              {creating ? 'Đang tạo…' : 'Tạo tài khoản nhân viên'}
            </button>
          </div>
        </div>
      </details>

      {editing && (
        <div className="card form" style={{ marginBottom: 16 }}>
          <div className="tb-toolbar" style={{ marginBottom: 6 }}>
            <strong>Cập nhật hồ sơ nhân sự xưởng</strong>
            <button type="button" className="link" onClick={() => setEditing(null)}>
              Đóng
            </button>
          </div>
          <div className="row">
            <label>
              Họ và tên
              <input
                type="text"
                value={editing.fullName}
                onChange={(e) => setEditing({ ...editing, fullName: e.target.value })}
              />
            </label>
            <label>
              Mã nhân viên
              <input
                type="text"
                placeholder="VD: NV01"
                value={editing.workerCode}
                onChange={(e) => setEditing({ ...editing, workerCode: e.target.value })}
              />
            </label>
            <label>
              Tổ / Bộ phận
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
              Vai trò
              <select
                value={editing.role}
                disabled={editing.role === 'super_admin' && !isSuperAdmin}
                onChange={(e) => setEditing({ ...editing, role: e.target.value as TbRole })}
              >
                <option value="staff">Công nhân / Nhân viên</option>
                <option value="manager">Quản lý xưởng</option>
                {isSuperAdmin && <option value="super_admin">Chủ xưởng</option>}
              </select>
            </label>
            <label>
              Số điện thoại
              <input
                type="tel"
                value={editing.phone}
                onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
              />
            </label>
          </div>
          <label>
            Ghi chú tay nghề / ca làm
            <input
              type="text"
              placeholder="VD: Chuyên may vắt sổ, làm ca hành chính…"
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
        <p className="muted">Đang tải danh sách nhân sự…</p>
      ) : list.error ? (
        <p className="error">{list.error}</p>
      ) : activeRows.length === 0 ? (
        <p className="muted">Chưa có nhân viên nào trong xưởng.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nhân viên</th>
                <th>Mã NV</th>
                <th>Tổ</th>
                <th>SĐT</th>
                <th>Trạng thái & Vai trò</th>
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
                        <span className="badge badge-master">Chủ xưởng</span>
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
                            onClick={() =>
                              setEditing({
                                userId: u.user_id,
                                fullName: u.full_name ?? '',
                                workerCode: u.worker_code ?? '',
                                department: u.department,
                                role: u.role,
                                phone: u.phone ?? '',
                                note: u.note ?? '',
                              })
                            }
                          >
                            Phân tổ / Sửa
                          </button>
                          {!isSelf && (u.role !== 'super_admin' || isSuperAdmin) && (
                            <>
                              <button type="button" className="link" onClick={() => resetPassword(u)}>
                                Đổi mật khẩu
                              </button>
                              <button type="button" className="link danger" onClick={() => lockOrReject(u)}>
                                Khoá quyền
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
