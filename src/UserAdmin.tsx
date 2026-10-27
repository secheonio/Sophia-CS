import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from './api'
import type { Meta, Position, User } from './types'

const AFFILIATION_COLUMNS = ['기초과정', '본과정', '심화과정', '교무부', '생활교육부', '교육과정연구부', '전형위원회', '생활관', '델포이', '행정실', '기타']
const EMPTY_AFFILIATIONS = Object.fromEntries(AFFILIATION_COLUMNS.map((department) => [department, '없음'])) as Record<string, '없음' | '부서원' | '부장'>

function toAffiliationRole(department: string, user: User): '없음' | '부서원' | '부장' {
  if (!user.departments.includes(department)) return '없음'
  return user.positions.includes('기관장') ? '부장' : user.positions.includes('기안자') ? '부서원' : '없음'
}

function toInternalRole(value: '없음' | '부서원' | '부장'): Position | null {
  if (value === '부장') return '기관장'
  if (value === '부서원') return '기안자'
  return null
}

type UserDraft = {
  email: string
  phone: string
  department: string
  position: Position
  departments: string[]
  positions: Position[]
  active: boolean
}

export function UserAdmin({ me, meta, onError }: { me: User; meta: Meta; onError: (message: string) => void }) {
  const defaultDepartments = meta.departmentsByPosition['기안자'] ?? meta.departments

  const [users, setUsers] = useState<User[]>([])
  const [drafts, setDrafts] = useState<Record<number, UserDraft>>({})
  const [quickAdd, setQuickAdd] = useState({
    name: '',
    email: '',
    phone: '',
    affiliations: { ...EMPTY_AFFILIATIONS },
  })

  const updateQuickAddField = (field: 'name' | 'email' | 'phone', value: string) => {
    setQuickAdd((current) => ({
      ...current,
      [field]: value,
    }))
  }

  const updateQuickAddAffiliation = (department: string, value: '없음' | '부서원' | '부장') => {
    setQuickAdd((current) => ({
      ...current,
      affiliations: {
        ...EMPTY_AFFILIATIONS,
        ...(current.affiliations ?? EMPTY_AFFILIATIONS),
        [department]: value,
      },
    }))
  }
  const [issued, setIssued] = useState<{ name: string; password: string } | null>(null)
  const [transfer, setTransfer] = useState<{ mode: 'existing' | 'new'; userId: string; name: string; email: string } | null>(null)

  async function transferPrincipal(event: FormEvent) {
    event.preventDefault()
    if (!transfer) return
    const target = transfer.mode === 'existing'
      ? users.find((user) => String(user.id) === transfer.userId)?.name
      : transfer.name
    if (!window.confirm(`${target ?? '선택한 사용자'}님을 새 교장으로 지정합니다.\n현재 교장(${me.name})의 계정은 사용 중지되고 즉시 로그아웃됩니다.\n진행하시겠습니까?`)) return
    try {
      const result = await api.transferPrincipal(
        transfer.mode === 'existing'
          ? { userId: Number(transfer.userId), confirm: true }
          : { name: transfer.name, email: transfer.email, confirm: true },
      )
      if (result.temporaryPassword) window.alert(`새 교장 임시 비밀번호: ${result.temporaryPassword}\n이 화면 이후에는 다시 볼 수 없습니다. 새 교장에게 직접 전달하세요.`)
      window.location.reload()
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : '교장을 교체하지 못했습니다.')
    }
  }

  const normalizeDraft = useCallback((user: User): UserDraft => ({
    email: user.email ?? '',
    phone: user.phone ?? '',
    department: user.department,
    position: user.position,
    departments: user.departments.length ? user.departments : [user.department],
    positions: user.positions.length ? user.positions : [user.position],
    active: user.active,
  }), [])

  const load = useCallback(async () => {
    try {
      const nextUsers = (await api.users()).users
      setUsers(nextUsers)
      setDrafts(Object.fromEntries(nextUsers.map((user) => [user.id, normalizeDraft(user)])))
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : '사용자 목록을 불러오지 못했습니다.')
    }
  }, [normalizeDraft, onError])

  useEffect(() => { void load() }, [load])

  async function addQuickRow() {
    const trimmedName = quickAdd.name.trim()
    if (!trimmedName) {
      onError('이름을 입력해 주세요.')
      return
    }
    const trimmedEmail = quickAdd.email.trim()
    const trimmedPhone = quickAdd.phone.trim()
    if (trimmedEmail && !/^[^@\s]+@[^@\s]+$/.test(trimmedEmail)) {
      onError('이메일 형식이 올바르지 않습니다. 예: anstnrdud@naver.com')
      return
    }
    if (trimmedPhone && !/^\d{3}-\d{4}-\d{4}$/.test(trimmedPhone)) {
      onError('전화번호 형식이 올바르지 않습니다. 예: 010-1234-5678')
      return
    }
    const selectedDepartments = AFFILIATION_COLUMNS.filter((department) => quickAdd.affiliations[department] !== '없음')
    const selectedPositions = selectedDepartments.flatMap((department) => {
      const role = quickAdd.affiliations[department]
      return role === '없음' ? [] : [toInternalRole(role)]
    }).filter((position): position is Position => position !== null)
    const primaryDepartment: string = selectedDepartments[0] ?? defaultDepartments[0] ?? '기타'
    const primaryPosition: Position = selectedPositions[0] ?? '기안자'
    try {
      const result = await api.addUser({
        name: trimmedName,
        email: trimmedEmail || undefined,
        phone: quickAdd.phone.trim() || undefined,
        department: primaryDepartment,
        position: primaryPosition,
        departments: selectedDepartments.length ? selectedDepartments : [primaryDepartment],
        positions: selectedPositions.length ? selectedPositions : [primaryPosition],
      })
      setIssued({ name: result.user.name, password: result.temporaryPassword })
      setQuickAdd({
        name: '',
        email: '',
        phone: '',
        affiliations: { ...EMPTY_AFFILIATIONS },
      })
      await load()
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : '사용자를 추가하지 못했습니다.')
    }
  }

  async function update(user: User, change: Partial<Pick<User, 'name' | 'email' | 'phone' | 'department' | 'position' | 'active'>> & { departments?: string[]; positions?: Position[] }) {
    try {
      await api.updateUser(user.id, change)
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : '변경하지 못했습니다.')
    }
    await load()
  }

  async function saveUser(user: User) {
    const draft = drafts[user.id]
    if (!draft) return

    const nextEmail = draft.email.trim()
    const nextPhone = draft.phone.trim()
    if (nextEmail && !/^[^@\s]+@[^@\s]+$/.test(nextEmail)) {
      onError('이메일 형식이 올바르지 않습니다. 예: anstnrdud@naver.com')
      return
    }
    if (nextPhone && !/^\d{3}-\d{4}-\d{4}$/.test(nextPhone)) {
      onError('전화번호 형식이 올바르지 않습니다. 예: 010-1234-5678')
      return
    }

    try {
      await api.updateUser(user.id, {
        email: nextEmail,
        phone: nextPhone,
        department: draft.department,
        position: draft.position,
        departments: draft.departments,
        positions: draft.positions,
        active: draft.active,
      })
      await load()
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : '변경 내용을 저장하지 못했습니다.')
    }
  }

  function updateContact(user: User, field: 'email' | 'phone', value: string) {
    const draft = drafts[user.id] ?? normalizeDraft(user)
    setDrafts((current) => ({
      ...current,
      [user.id]: {
        ...draft,
        [field]: value,
      },
    }))
  }

  function updateAffiliationRole(user: User, department: string, nextValue: '없음' | '부서원' | '부장') {
    const draft = drafts[user.id] ?? normalizeDraft(user)
    const nextDepartments = nextValue === '없음'
      ? draft.departments.filter((item) => item !== department)
      : Array.from(new Set([...draft.departments.filter((item) => item !== department), department]))
    const internalRole = toInternalRole(nextValue)
    const nextPositions = internalRole
      ? Array.from(new Set([...draft.positions.filter((position) => position !== '기안자' && position !== '기관장'), internalRole]))
      : draft.positions.filter((position) => position !== '기안자' && position !== '기관장')
    const nextPrimaryDepartment = nextDepartments[0] ?? draft.department
    const nextPrimaryPosition = nextPositions[0] ?? draft.position
    setDrafts((current) => ({
      ...current,
      [user.id]: {
        ...draft,
        department: nextPrimaryDepartment,
        departments: nextDepartments.length ? nextDepartments : [draft.department],
        position: nextPrimaryPosition,
        positions: nextPositions.length ? nextPositions : [draft.position],
      },
    }))
  }

  async function reset(user: User) {
    if (!window.confirm(`${user.name}님의 비밀번호를 초기화할까요? 기존 로그인은 모두 해제됩니다.`)) return
    try {
      setIssued({ name: user.name, password: (await api.resetPassword(user.id)).temporaryPassword })
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : '초기화하지 못했습니다.')
    }
  }

  async function removeUser(user: User) {
    if (!window.confirm(`${user.name}님을 목록에서 삭제할까요? 사용 중에서 비활성화됩니다.`)) return
    try {
      await api.deleteUser(user.id)
      await load()
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : '사용자를 삭제하지 못했습니다.')
    }
  }

  return (
    <div className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ADMIN</div>
          <h1>사용자·직책</h1>
          <p>교장(관리자)만 사용자를 추가하고 배치 정보를 지정할 수 있습니다. 각 교사는 여러 소속과 여러 직책을 가질 수 있고, 교장만 이를 관리할 수 있습니다.</p>
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
        <div className="panel-heading"><div><h2>교장 교체</h2><p>교장이 바뀔 때 관리자 권한과 결재권을 새 교장에게 넘깁니다. 진행 중인 교장 결재도 함께 넘어가고, 새 교장은 과거 품의도 모두 볼 수 있습니다.</p></div>
          {!transfer && <button type="button" className="cancel-button" onClick={() => setTransfer({ mode: 'new', userId: '', name: '', email: '' })}>교장 교체 시작</button>}
        </div>
        {transfer && (
          <form className="user-form" onSubmit={(event) => void transferPrincipal(event)}>
            <label className="form-field"><span>방식</span>
              <select value={transfer.mode} onChange={(e) => setTransfer({ ...transfer, mode: e.currentTarget.value as 'existing' | 'new' })}>
                <option value="new">새 사용자로 등록</option>
                <option value="existing">기존 사용자 지정</option>
              </select>
            </label>
            {transfer.mode === 'new' ? (
              <>
                <label className="form-field"><span>이름</span><input value={transfer.name} onChange={(e) => setTransfer({ ...transfer, name: e.currentTarget.value })} required maxLength={30} /></label>
                <label className="form-field"><span>이메일</span><input type="email" value={transfer.email} onChange={(e) => setTransfer({ ...transfer, email: e.currentTarget.value })} required /></label>
              </>
            ) : (
              <label className="form-field"><span>새 교장</span>
                <select value={transfer.userId} onChange={(e) => setTransfer({ ...transfer, userId: e.currentTarget.value })} required>
                  <option value="">선택</option>
                  {users.filter((user) => user.active && user.id !== me.id && user.position !== '행정실장').map((user) => (
                    <option key={user.id} value={user.id}>{user.name} · {user.department} {user.position}</option>
                  ))}
                </select>
              </label>
            )}
            <button className="cancel-button" type="button" onClick={() => setTransfer(null)}>취소</button>
            <button className="reject-confirm" type="submit">교장 교체 실행</button>
          </form>
        )}
      </section>

      <section className="requests-panel">
        <div className="panel-heading"><div><h2>사용자 목록</h2><p>총 {users.length}명</p></div></div>
        <div className="table-wrap">
          <table className="user-matrix-table">
            <thead>
              <tr>
                <th>이름</th>
                <th>이메일</th>
                <th>전화번호</th>
                {AFFILIATION_COLUMNS.map((department) => <th key={department}>{department}</th>)}
                <th>상태</th>
                <th /></tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const draft = drafts[user.id] ?? normalizeDraft(user)
                const currentUser = { ...user, ...draft, departments: draft.departments, positions: draft.positions }
                const isMe = user.id === me.id
                const isDirty = JSON.stringify(draft) !== JSON.stringify(normalizeDraft(user))
                return (
                  <tr key={user.id} className={user.active ? '' : 'row-inactive'}>
                    <td>{user.name}</td>
                    <td><input type="text" inputMode="email" pattern="^[^@\\s]+@[^@\\s]+$" title="anstnrdud@naver.com" value={draft.email} onChange={(e) => updateContact(user, 'email', e.currentTarget.value)} /></td>
                    <td><input type="tel" pattern="^\\d{3}-\\d{4}-\\d{4}$" title="010-1234-5678" value={draft.phone} onChange={(e) => updateContact(user, 'phone', e.currentTarget.value)} /></td>
                    {AFFILIATION_COLUMNS.map((department) => (
                      <td key={`${user.id}-${department}`}>
                        <select aria-label={`${user.name} ${department} 소속`} value={toAffiliationRole(department, currentUser)} disabled={isMe} onChange={(e) => {
                          const nextValue = e.currentTarget.value as '없음' | '부서원' | '부장'
                          updateAffiliationRole(user, department, nextValue)
                        }}>
                          <option value="없음">없음</option>
                          <option value="부서원">부서원</option>
                          <option value="부장">부장</option>
                        </select>
                      </td>
                    ))}
                    <td>{user.active ? '사용 중' : '사용 중지'}</td>
                    <td className="user-actions">
                      <button type="button" className="primary-button" disabled={!isDirty} onClick={() => void saveUser(user)}>저장</button>
                      <button type="button" className="cancel-button" onClick={() => void reset(user)}>비밀번호 초기화</button>
                      {!isMe && <button type="button" className="cancel-button" onClick={() => void update(user, { active: !user.active })}>{user.active ? '사용 중지' : '다시 사용'}</button>}
                      {!isMe && <button type="button" className="reject-confirm" onClick={() => void removeUser(user)}>삭제</button>}
                    </td>
                  </tr>
                )
              })}
              <tr className="new-user-row">
                <td><input value={quickAdd.name} onChange={(e) => updateQuickAddField('name', e.target.value)} placeholder="이름" /></td>
                <td><input type="text" inputMode="email" pattern="^[^@\\s]+@[^@\\s]+$" title="anstnrdud@naver.com" value={quickAdd.email} onChange={(e) => updateQuickAddField('email', e.target.value)} placeholder="이메일 (선택)" /></td>
                <td><input type="tel" pattern="^\\d{3}-\\d{4}-\\d{4}$" title="010-1234-5678" value={quickAdd.phone} onChange={(e) => updateQuickAddField('phone', e.target.value)} placeholder="전화번호 (선택)" /></td>
                {AFFILIATION_COLUMNS.map((department) => (
                  <td key={`quick-${department}`}>
                    <select value={quickAdd.affiliations[department] ?? '없음'} onChange={(e) => updateQuickAddAffiliation(department, e.target.value as '없음' | '부서원' | '부장')}>
                      <option value="없음">없음</option>
                      <option value="부서원">부서원</option>
                      <option value="부장">부장</option>
                    </select>
                  </td>
                ))}
                <td>신규</td>
                <td className="user-actions">
                  <button type="button" className="primary-button" onClick={() => void addQuickRow()}>추가</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
