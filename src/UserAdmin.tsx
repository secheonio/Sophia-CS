import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from './api'
import type { Meta, Position, User } from './types'

export function UserAdmin({ me, meta, onError }: { me: User; meta: Meta; onError: (message: string) => void }) {
  const [users, setUsers] = useState<User[]>([])
  const [form, setForm] = useState({ name: '', email: '', department: meta.departments[0], position: '기안자' as Position })
  const [issued, setIssued] = useState<{ name: string; password: string } | null>(null)

  const allowedDepartments = meta.departmentsByPosition[form.position] ?? meta.departments

  const load = useCallback(async () => {
    try {
      setUsers((await api.users()).users)
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : '사용자 목록을 불러오지 못했습니다.')
    }
  }, [onError])

  useEffect(() => { void load() }, [load])

  function changePosition(position: Position) {
    const departments = meta.departmentsByPosition[position] ?? meta.departments
    setForm((current) => ({
      ...current,
      position,
      department: departments.includes(current.department) ? current.department : departments[0],
    }))
  }

  async function add(event: FormEvent) {
    event.preventDefault()
    try {
      const result = await api.addUser(form)
      setIssued({ name: result.user.name, password: result.temporaryPassword })
      setForm((current) => ({ ...current, name: '', email: '' }))
      await load()
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : '사용자를 추가하지 못했습니다.')
    }
  }

  async function update(user: User, change: Partial<Pick<User, 'department' | 'position' | 'active'>>) {
    try {
      await api.updateUser(user.id, change)
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : '변경하지 못했습니다.')
    }
    await load()
  }

  async function reset(user: User) {
    if (!window.confirm(`${user.name}님의 비밀번호를 초기화할까요? 기존 로그인은 모두 해제됩니다.`)) return
    try {
      setIssued({ name: user.name, password: (await api.resetPassword(user.id)).temporaryPassword })
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : '초기화하지 못했습니다.')
    }
  }

  return (
    <div className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ADMIN</div>
          <h1>사용자·직책</h1>
          <p>교장(관리자)만 사용자를 추가하고 직책을 지정할 수 있습니다. 교장·행정실장은 1명, 기관장은 부서당 1명입니다.</p>
        </div>
      </div>

      {issued && (
        <div className="temp-password" role="status">
          <strong>{issued.name}님의 임시 비밀번호</strong>
          <code>{issued.password}</code>
          <span>이 화면에서만 확인할 수 있습니다. 본인에게 직접 전달하세요. 첫 로그인 때 변경하게 됩니다.</span>
          <button type="button" className="cancel-button" onClick={() => setIssued(null)}>닫기</button>
        </div>
      )}

      <section className="requests-panel">
        <div className="panel-heading"><div><h2>사용자 추가</h2></div></div>
        <form className="user-form" onSubmit={add}>
          <label className="form-field"><span>이름</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} required maxLength={30} /></label>
          <label className="form-field"><span>이메일</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.currentTarget.value })} required /></label>
          <label className="form-field"><span>직책</span>
            <select value={form.position} onChange={(e) => changePosition(e.currentTarget.value as Position)}>
              {meta.positions.map((position) => <option key={position}>{position}</option>)}
            </select>
          </label>
          <label className="form-field"><span>소속</span>
            <select value={form.department} onChange={(e) => setForm({ ...form, department: e.currentTarget.value })}>
              {allowedDepartments.map((department) => <option key={department}>{department}</option>)}
            </select>
          </label>
          <button className="primary-button" type="submit">추가</button>
        </form>
      </section>

      <section className="requests-panel">
        <div className="panel-heading"><div><h2>사용자 목록</h2><p>총 {users.length}명</p></div></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>이름</th><th>이메일</th><th>소속</th><th>직책</th><th>상태</th><th /></tr></thead>
            <tbody>
              {users.map((user) => {
                const isMe = user.id === me.id
                const departments = meta.departmentsByPosition[user.position] ?? meta.departments
                return (
                  <tr key={user.id} className={user.active ? '' : 'row-inactive'}>
                    <td>{user.name}{user.mustChangePassword && <small className="dept-tag">임시 비밀번호</small>}</td>
                    <td>{user.email}</td>
                    <td>
                      <select aria-label={`${user.name} 소속`} value={user.department} disabled={isMe} onChange={(e) => void update(user, { department: e.currentTarget.value })}>
                        {departments.map((department) => <option key={department}>{department}</option>)}
                      </select>
                    </td>
                    <td>
                      <select aria-label={`${user.name} 직책`} value={user.position} disabled={isMe} onChange={(e) => {
                        const position = e.currentTarget.value as Position
                        const allowed = meta.departmentsByPosition[position] ?? meta.departments
                        void update(user, { position, department: allowed.includes(user.department) ? user.department : allowed[0] })
                      }}>
                        {meta.positions.map((position) => <option key={position}>{position}</option>)}
                      </select>
                    </td>
                    <td>{user.active ? '사용 중' : '사용 중지'}</td>
                    <td className="user-actions">
                      <button type="button" className="cancel-button" onClick={() => void reset(user)}>비밀번호 초기화</button>
                      {!isMe && <button type="button" className="cancel-button" onClick={() => void update(user, { active: !user.active })}>{user.active ? '사용 중지' : '다시 사용'}</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
