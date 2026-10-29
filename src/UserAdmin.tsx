import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { api, ApiError } from './api'
import type { Meta, Position, User } from './types'
import {
  AFFILIATION_COLUMNS,
  EMPTY_AFFILIATIONS,
  buildDepartmentRoles,
  derivePrimaryDepartment,
  derivePrimaryPosition,
  getSelectedDepartmentRoles,
  getSelectedPositions,
  sanitizeDepartmentRoles,
  toInternalRole,
  type AffiliationRole,
} from './userRoleLogic'

type TableColumnKey = 'name' | 'email' | 'phone' | 'department' | 'status' | 'action'

const DEFAULT_TABLE_COLUMN_WIDTHS: Record<TableColumnKey, number> = {
  name: 52,
  email: 180,
  phone: 112,
  department: 42,
  status: 64,
  action: 236,
}
const EXTRA_CONTENT_CHAR_COUNT = 5

function measureTextWidth(text: string) {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return 0
  context.font = '600 7.5px "DM Sans", "Noto Sans KR", "Malgun Gothic", sans-serif'
  return Math.ceil(context.measureText(text).width)
}


type UserDraft = {
  email: string
  phone: string
  department: string
  position: Position
  departments: string[]
  positions: Position[]
  departmentRoles: Record<string, AffiliationRole>
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
  const [tableColumnWidths, setTableColumnWidths] = useState<Record<TableColumnKey, number>>(DEFAULT_TABLE_COLUMN_WIDTHS)
  const tableRef = useRef<HTMLTableElement | null>(null)

  const updateQuickAddField = (field: 'name' | 'email' | 'phone', value: string) => {
    const nextValue = field === 'phone' ? normalizePhoneInput(value) : value
    setQuickAdd((current) => ({
      ...current,
      [field]: nextValue,
    }))
  }

  const updateQuickAddAffiliation = (department: string, value: '없음' | '부장') => {
    setQuickAdd((current) => ({
      ...current,
      affiliations: {
        ...EMPTY_AFFILIATIONS,
        ...(current.affiliations ?? EMPTY_AFFILIATIONS),
        [department]: value,
      },
    }))
  }

  const displayAffiliationRole = (value: AffiliationRole | undefined | null): '없음' | '부장' => {
    if (value === '부장') return '부장'
    return '없음'
  }
  const [issued, setIssued] = useState<{ name: string; password: string } | null>(null)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  const [transfer, setTransfer] = useState<{ mode: 'existing' | 'new'; userId: string; name: string; email: string } | null>(null)

  const normalizePhoneInput = (value: string) => value.replace(/\D/g, '').slice(0, 11)

  function describeUserChanges(user: User, draft: UserDraft) {
    const before = normalizeDraft(user)
    const beforeLeadDepartments = AFFILIATION_COLUMNS.filter((department) => before.departmentRoles[department] === '부장')
    const afterLeadDepartments = AFFILIATION_COLUMNS.filter((department) => draft.departmentRoles[department] === '부장')
    const details: string[] = []

    if (before.email !== draft.email) {
      details.push(`이메일 ${before.email || '없음'} → ${draft.email || '없음'}`)
    }
    if (before.phone !== draft.phone) {
      details.push(`전화번호 ${before.phone || '없음'} → ${draft.phone || '없음'}`)
    }
    if (before.position !== draft.position) {
      details.push(`직위 ${before.position || '기안자'} → ${draft.position || '기안자'}`)
    }
    if (beforeLeadDepartments.join(',') !== afterLeadDepartments.join(',')) {
      const beforeText = beforeLeadDepartments.length ? beforeLeadDepartments.join(', ') : '없음'
      const afterText = afterLeadDepartments.length ? afterLeadDepartments.join(', ') : '없음'
      details.push(`소속 ${beforeText} → ${afterText}`)
    }

    if (!details.length) {
      return `${user.name}: 변경 없음`
    }

    return `${user.name}: ${details.join(' / ')}`
  }

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

  const normalizeDraft = useCallback((user: User): UserDraft => {
    const departmentRoles = buildDepartmentRoles(user)
    const selectedDepartments = getSelectedDepartmentRoles(departmentRoles)
    const primaryDepartment = derivePrimaryDepartment(user.department, selectedDepartments, departmentRoles)
    const primaryPosition = derivePrimaryPosition(primaryDepartment, departmentRoles, user.position)
    const positions = getSelectedPositions(departmentRoles)

    return {
      email: user.email ?? '',
      phone: user.phone ?? '',
      department: primaryDepartment ?? user.department ?? '기타',
      position: primaryPosition,
      departments: selectedDepartments.length ? selectedDepartments : [user.department ?? '기타'],
      positions: positions.length ? positions : [primaryPosition],
      departmentRoles,
      active: user.active,
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const nextUsers = (await api.users()).users
      setUsers(nextUsers)
      setDrafts(Object.fromEntries(nextUsers.map((user) => [user.id, normalizeDraft(user)])))
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : '사용자 목록을 불러오지 못했습니다.')
    }
  }, [normalizeDraft, onError])

  useEffect(() => {
    if (!tableRef.current) return

    const nameValues = users.map((user) => user.name).concat(quickAdd.name || '이름')
    const emailValues = users.map((user) => drafts[user.id]?.email ?? '').concat(quickAdd.email || '이메일')
    const phoneValues = users.map((user) => drafts[user.id]?.phone ?? '').concat(quickAdd.phone || '01000000000')
    const departmentValues = AFFILIATION_COLUMNS.flatMap((department: string) => (
      users.map((user) => drafts[user.id]?.departmentRoles?.[department] ?? '없음')
        .concat(quickAdd.affiliations[department] ?? '없음'))
    )
    const statusValues: string[] = [...users.map((user) => (user.active ? '사용 중' : '사용 중지')), '신규']
    const actionValues = ['저장', '비번초기화', '사용중지', '재사용', '삭제', '추가']

    const nextWidths: Record<TableColumnKey, number> = {
      name: Math.max(DEFAULT_TABLE_COLUMN_WIDTHS.name, ...nameValues.map((value) => measureTextWidth(value) + 18)),
      email: Math.max(
        DEFAULT_TABLE_COLUMN_WIDTHS.email,
        ...emailValues.map((value) => measureTextWidth(`${value || '이메일'}${'M'.repeat(EXTRA_CONTENT_CHAR_COUNT)}`) + 18),
      ),
      phone: Math.max(DEFAULT_TABLE_COLUMN_WIDTHS.phone, ...phoneValues.map((value) => measureTextWidth(value || '01000000000') + 18)),
      department: Math.max(DEFAULT_TABLE_COLUMN_WIDTHS.department, ...departmentValues.map((value) => measureTextWidth(value) + 16)),
      status: Math.max(DEFAULT_TABLE_COLUMN_WIDTHS.status, ...statusValues.map((value) => measureTextWidth(value) + 18)),
      action: Math.max(DEFAULT_TABLE_COLUMN_WIDTHS.action, ...actionValues.map((value) => measureTextWidth(value) + 24)),
    }

    setTableColumnWidths(nextWidths)
  }, [drafts, quickAdd, users])

  useEffect(() => { void load() }, [load])

  async function addQuickRow() {
    const trimmedName = quickAdd.name.trim()
    if (!trimmedName) {
      onError('이름을 입력해 주세요.')
      return
    }
    const trimmedEmail = quickAdd.email.trim()
    const trimmedPhone = quickAdd.phone.trim()
    if (trimmedEmail && !trimmedEmail.includes('@')) {
      onError('이메일은 @를 포함해야 합니다.')
      return
    }
    if (trimmedPhone && !/^\d{10,11}$/.test(trimmedPhone)) {
      onError('전화번호 형식이 올바르지 않습니다. 예: 01012345678')
      return
    }
    const selectedDepartments = AFFILIATION_COLUMNS.filter((department: string) => quickAdd.affiliations[department] !== '없음')
    const selectedPositions = selectedDepartments.flatMap((department: string) => {
      const role = quickAdd.affiliations[department]
      return role === '없음' ? [] : [toInternalRole(role, department)]
    }).filter((position: Position | null): position is Position => position !== null)
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

  async function saveAllUsers() {
    const dirtyUsers = users.filter((user) => {
      const draft = drafts[user.id] ?? normalizeDraft(user)
      return JSON.stringify(draft) !== JSON.stringify(normalizeDraft(user))
    })

    if (!dirtyUsers.length) return

    try {
      for (const user of dirtyUsers) {
        const draft = drafts[user.id] ?? normalizeDraft(user)
        const nextEmail = draft.email.trim()
        const nextPhone = draft.phone.trim()

        if (nextEmail && !nextEmail.includes('@')) {
          throw new Error(`${user.name}의 이메일은 @를 포함해야 합니다.`)
        }
        if (nextPhone && !/^\d{10,11}$/.test(nextPhone)) {
          throw new Error(`${user.name}의 전화번호가 올바르지 않습니다.`)
        }

        await api.updateUser(user.id, {
          email: nextEmail,
          phone: nextPhone,
          department: draft.department,
          position: draft.position,
          departments: draft.departments,
          positions: draft.positions,
          active: draft.active,
        })
      }

      await load()
      const savedSummaries = dirtyUsers.map((user) => {
        const draft = drafts[user.id] ?? normalizeDraft(user)
        return describeUserChanges(user, draft)
      })
      setSaveNotice(`${dirtyUsers.length}명의 변경 사항이 저장되었습니다. ${savedSummaries.join(' / ')}`)
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : '변경 내용을 저장하지 못했습니다.')
    }
  }

  function updateContact(user: User, field: 'email' | 'phone', value: string) {
    const draft = drafts[user.id] ?? normalizeDraft(user)
    const nextValue = field === 'phone' ? normalizePhoneInput(value) : value
    setDrafts((current) => ({
      ...current,
      [user.id]: {
        ...draft,
        [field]: nextValue,
      },
    }))
  }

  function updateAffiliationRole(user: User, department: string, nextValue: AffiliationRole) {
    const draft = drafts[user.id] ?? normalizeDraft(user)
    const nextRoles = sanitizeDepartmentRoles(
      { ...draft.departmentRoles, [department]: nextValue },
      department,
    )

    const nextDepartments = getSelectedDepartmentRoles(nextRoles)
    const nextPrimaryDepartment = derivePrimaryDepartment(draft.department, nextDepartments, nextRoles, department)
    const nextPrimaryPosition = derivePrimaryPosition(nextPrimaryDepartment, nextRoles, draft.position)
    const nextPositions = getSelectedPositions(nextRoles)

    setDrafts((current) => ({
      ...current,
      [user.id]: {
        ...draft,
        department: nextPrimaryDepartment ?? draft.department ?? '기타',
        departments: nextDepartments.length ? nextDepartments : [nextPrimaryDepartment ?? draft.department ?? '기타'],
        position: nextPrimaryPosition,
        positions: nextPositions.length ? nextPositions : [nextPrimaryPosition],
        departmentRoles: nextRoles,
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

      {saveNotice && (
        <div className="temp-password" role="status">
          <strong>저장 결과</strong>
          <span>{saveNotice}</span>
          <button type="button" className="cancel-button" onClick={() => setSaveNotice(null)}>닫기</button>
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
        <div className="panel-heading">
          <div><h2>사용자 목록({users.length}명)</h2></div>
          <button type="button" className="primary-button" onClick={() => void saveAllUsers()}>저장하기</button>
        </div>
        <div className="table-wrap">
          <table ref={tableRef} className="user-matrix-table">
            <thead>
              <tr>
                <th style={{ width: tableColumnWidths.name }}>이름</th>
                <th style={{ width: tableColumnWidths.email }}>이메일</th>
                <th style={{ width: tableColumnWidths.phone }}>전화번호</th>
                {AFFILIATION_COLUMNS.map((department: string) => <th key={department} style={{ width: tableColumnWidths.department }}>{department}</th>)}
                <th style={{ width: tableColumnWidths.status }}>상태</th>
                <th style={{ width: tableColumnWidths.action }} /></tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const draft = drafts[user.id] ?? normalizeDraft(user)
                const isMe = user.id === me.id
                return (
                  <tr key={user.id} className={user.active ? '' : 'row-inactive'}>
                    <td style={{ width: tableColumnWidths.name }}>{user.name}</td>
                    <td style={{ width: tableColumnWidths.email }}><input type="text" inputMode="email" pattern="^[^@\\s]+@[^@\\s]+$" title="anstnrdud@naver.com" value={draft.email} onChange={(e) => updateContact(user, 'email', e.currentTarget.value)} /></td>
                    <td style={{ width: tableColumnWidths.phone }}><input type="tel" inputMode="numeric" pattern="^\\d{10,11}$" title="01012345678" value={draft.phone} onChange={(e) => updateContact(user, 'phone', e.currentTarget.value)} /></td>
                    {AFFILIATION_COLUMNS.map((department: string) => {
                      const isHeadDepartment = draft.departmentRoles[department] === '부장'
                      return (
                        <td key={`${user.id}-${department}`} style={{ width: tableColumnWidths.department }} className={isHeadDepartment ? 'role-cell role-cell-head' : 'role-cell'}>
                          <select
                            aria-label={`${user.name} ${department} 소속`}
                            className={isHeadDepartment ? 'role-select role-select-head' : 'role-select role-select-none'}
                            value={displayAffiliationRole(draft.departmentRoles[department])}
                            disabled={isMe}
                            onChange={(e) => {
                              const nextValue = e.currentTarget.value as '없음' | '부장'
                              updateAffiliationRole(user, department, nextValue)
                            }}
                          >
                            <option value="없음">없음</option>
                            <option value="부장">부장</option>
                          </select>
                        </td>
                      )
                    })}
                    <td style={{ width: tableColumnWidths.status }}>{user.active ? '사용 중' : '사용 중지'}</td>
                    <td className="user-actions" style={{ width: tableColumnWidths.action, minWidth: tableColumnWidths.action }}>
                      <button type="button" className="cancel-button" onClick={() => void reset(user)}>비번초기화</button>
                      {!isMe && <button type="button" className="cancel-button" onClick={() => void update(user, { active: !user.active })}>{user.active ? '사용중지' : '재사용'}</button>}
                      {!isMe && <button type="button" className="reject-confirm" onClick={() => void removeUser(user)}>삭제</button>}
                    </td>
                  </tr>
                )
              })}
              <tr className="new-user-row">
                <td style={{ width: tableColumnWidths.name }}><input value={quickAdd.name} onChange={(e) => updateQuickAddField('name', e.target.value)} placeholder="이름" /></td>
                <td style={{ width: tableColumnWidths.email }}><input type="text" inputMode="email" pattern="^[^@\\s]+@[^@\\s]+$" title="anstnrdud@naver.com" value={quickAdd.email} onChange={(e) => updateQuickAddField('email', e.target.value)} placeholder="이메일 (선택)" /></td>
                <td style={{ width: tableColumnWidths.phone }}><input type="tel" inputMode="numeric" pattern="^\\d{10,11}$" title="01012345678" value={quickAdd.phone} onChange={(e) => updateQuickAddField('phone', normalizePhoneInput(e.target.value))} placeholder="전화번호 (선택)" /></td>
                {AFFILIATION_COLUMNS.map((department: string) => (
                  <td key={`quick-${department}`} style={{ width: tableColumnWidths.department }}>
                    <select value={quickAdd.affiliations[department] ?? '없음'} onChange={(e) => updateQuickAddAffiliation(department, e.target.value as '없음' | '부장')}>
                      <option value="없음">없음</option>
                      <option value="부장">부장</option>
                    </select>
                  </td>
                ))}
                <td style={{ width: tableColumnWidths.status }}>신규</td>
                <td className="user-actions" style={{ width: tableColumnWidths.action, minWidth: tableColumnWidths.action }}>
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
