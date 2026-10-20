import { useState, type ChangeEvent, type FormEvent } from 'react'
import './App.css'

type Position = '교장' | '행정실장' | '기관장' | '기안자'
type StepKind = '확인 결재' | '최종 결재' | '지출 처리'
type StepStatus = '대기' | '결재 중' | '승인' | '반려'
type RequestStatus = '결재 중' | '지출 대기' | '지출 완료' | '반려'
type FilterStatus = '전체' | RequestStatus

interface Person {
  name: string
  department: string
  position: Position
}

interface ApprovalStep {
  name: string
  position: Position
  kind: StepKind
  status: StepStatus
  date?: string
}

interface ExpenseRequest {
  id: number
  code: string
  title: string
  requester: string
  department: string
  category: string
  amount: number
  date: string
  status: RequestStatus
  memo: string
  steps: ApprovalStep[]
}

const departments = [
  '기초과정', '본과정', '심화과정', '생활교육부', '교무부',
  '교육과정부', '델포이', '생활관', '행정실',
]

// 시연용 가상 인물입니다. 실제 사용자는 교장(관리자)이 등록합니다.
const people: Person[] = [
  { name: '이교장', department: '교장', position: '교장' },
  { name: '박행정', department: '행정실', position: '행정실장' },
  { name: '김기초', department: '기초과정', position: '기관장' },
  { name: '최교무', department: '교무부', position: '기관장' },
  { name: '정생활', department: '생활교육부', position: '기관장' },
  { name: '한기안', department: '기초과정', position: '기안자' },
  { name: '윤교무', department: '교무부', position: '기안자' },
]

const categories = ['교육활동비', '여비교통비', '비품·소모품', '시설·수선비', '복리후생비', '기타']
const filters: FilterStatus[] = ['전체', '결재 중', '지출 대기', '지출 완료', '반려']

const principal = people.find((person) => person.position === '교장')!
const accountant = people.find((person) => person.position === '행정실장')!

function today() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function findPerson(name: string) {
  return people.find((person) => person.name === name)
}

function findHead(department: string) {
  return people.find(
    (person) => person.department === department && (person.position === '기관장' || person.position === '행정실장'),
  )
}

// 기안자 → 담당 기관장 확인 → 교장 최종 결재 → 행정실장 지출 처리
function buildSteps(requester: Person): ApprovalStep[] {
  const steps: ApprovalStep[] = []
  const head = findHead(requester.department)

  if (requester.position !== '교장') {
    if (head && head.name !== requester.name) {
      steps.push({ name: head.name, position: head.position, kind: '확인 결재', status: '대기' })
    }
    steps.push({ name: principal.name, position: principal.position, kind: '최종 결재', status: '대기' })
  }
  steps.push({ name: accountant.name, position: accountant.position, kind: '지출 처리', status: '대기' })
  steps[0].status = '결재 중'
  return steps
}

function deriveStatus(steps: ApprovalStep[]): RequestStatus {
  if (steps.some((step) => step.status === '반려')) return '반려'
  if (steps.every((step) => step.status === '승인')) return '지출 완료'
  const current = steps.find((step) => step.status === '결재 중')
  return current?.kind === '지출 처리' ? '지출 대기' : '결재 중'
}

function makeRequest(
  id: number,
  fields: Omit<ExpenseRequest, 'id' | 'code' | 'status' | 'steps' | 'department'>,
  stepStates: Array<[StepStatus, string?]>,
): ExpenseRequest {
  const requester = findPerson(fields.requester)!
  const steps = buildSteps(requester).map((step, index) => ({
    ...step,
    status: stepStates[index]?.[0] ?? '대기',
    date: stepStates[index]?.[1],
  }))
  return {
    ...fields,
    id,
    code: `EXP-2026-${String(id).padStart(3, '0')}`,
    department: requester.department,
    steps,
    status: deriveStatus(steps),
  }
}

const initialRequests: ExpenseRequest[] = [
  makeRequest(4, { title: '신입 과정 교구 구입', requester: '한기안', category: '비품·소모품', amount: 185000, date: '2026-10-19', memo: '기초과정 실습용 교구 구입비입니다.' }, [['결재 중']]),
  makeRequest(3, { title: '학부모 상담 다과비', requester: '윤교무', category: '교육활동비', amount: 64000, date: '2026-10-18', memo: '학부모 상담 주간 다과 구입비입니다.' }, [['승인', '2026-10-18'], ['결재 중']]),
  makeRequest(2, { title: '현장학습 버스 대절', requester: '한기안', category: '여비교통비', amount: 920000, date: '2026-10-16', memo: '10월 현장학습 이동 버스 대절비입니다.' }, [['승인', '2026-10-16'], ['승인', '2026-10-17'], ['결재 중']]),
  makeRequest(1, { title: '생활관 소모품 구입', requester: '정생활', category: '비품·소모품', amount: 142000, date: '2026-10-14', memo: '생활관 청소용품 구입비입니다.' }, [['승인', '2026-10-14'], ['승인', '2026-10-15'], ['승인', '2026-10-15']]),
]

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('ko-KR').format(amount)
}

function slug(value: string) {
  return value.replaceAll(' ', '-')
}

function stepStateLabel(step: ApprovalStep) {
  const label = step.status === '승인' && step.kind === '지출 처리' ? '지출 완료' : step.status
  return step.date ? `${label} · ${step.date}` : label
}

function StatusBadge({ status }: { status: RequestStatus }) {
  return <span className={`status-badge status-${slug(status)}`}>{status}</span>
}

const emptyForm = { title: '', category: categories[0], amount: '', memo: '' }

function App() {
  const [requests, setRequests] = useState(initialRequests)
  const [selectedId, setSelectedId] = useState(4)
  const [activeFilter, setActiveFilter] = useState<FilterStatus>('전체')
  const [activeUser, setActiveUser] = useState('한기안')
  const [search, setSearch] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('전체 부서')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState(emptyForm)

  const activePerson = findPerson(activeUser)!
  const previewSteps = buildSteps(activePerson)
  const selectedRequest = requests.find((request) => request.id === selectedId)
  const query = search.trim().toLocaleLowerCase()
  const filteredRequests = requests.filter((request) => {
    const matchesFilter =
      (activeFilter === '전체' || request.status === activeFilter) &&
      (departmentFilter === '전체 부서' || request.department === departmentFilter)
    const matchesSearch =
      query.length === 0 ||
      `${request.code} ${request.title} ${request.requester} ${request.department}`.toLocaleLowerCase().includes(query)
    return matchesFilter && matchesSearch
  })

  const currentStep = selectedRequest?.steps.find((step) => step.status === '결재 중')
  const canDecide = currentStep?.name === activeUser
  const canResubmit = selectedRequest?.status === '반려' && selectedRequest.requester === activeUser
  const waitingCount = requests.filter((request) =>
    request.steps.some((step) => step.name === activeUser && step.status === '결재 중'),
  ).length
  const inProgressCount = requests.filter((request) => request.status === '결재 중').length
  const payoutWaitingCount = requests.filter((request) => request.status === '지출 대기').length
  const paidRequests = requests.filter((request) => request.status === '지출 완료')
  const paidAmount = paidRequests.reduce((sum, request) => sum + request.amount, 0)

  function updateForm(event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value } = event.currentTarget
    setForm((current) => ({ ...current, [name]: value }))
  }

  function openNewForm() {
    setNotice('')
    setEditingId(null)
    setForm(emptyForm)
    setIsFormOpen(true)
  }

  function openEditForm(request: ExpenseRequest) {
    setNotice('')
    setEditingId(request.id)
    setForm({ title: request.title, category: request.category, amount: String(request.amount), memo: request.memo })
    setIsFormOpen(true)
  }

  function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const amount = Number(form.amount)
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setNotice('금액은 1원 이상의 정수로 입력해 주세요.')
      return
    }

    const fields = { title: form.title.trim(), category: form.category, amount, memo: form.memo.trim() }

    if (editingId !== null) {
      setRequests((current) =>
        current.map((request) => {
          if (request.id !== editingId) return request
          const steps = buildSteps(activePerson)
          return { ...request, ...fields, date: today(), steps, status: deriveStatus(steps) }
        }),
      )
      setSelectedId(editingId)
      setNotice('수정한 지출품의를 다시 결재 요청했습니다.')
    } else {
      const nextId = Math.max(...requests.map((request) => request.id)) + 1
      const steps = buildSteps(activePerson)
      const newRequest: ExpenseRequest = {
        id: nextId,
        code: `EXP-${new Date().getFullYear()}-${String(nextId).padStart(3, '0')}`,
        requester: activePerson.name,
        department: activePerson.department,
        date: today(),
        ...fields,
        steps,
        status: deriveStatus(steps),
      }
      setRequests((current) => [newRequest, ...current])
      setSelectedId(nextId)
      setActiveFilter('전체')
      setNotice('새 지출품의를 결재 요청했습니다.')
    }

    setForm(emptyForm)
    setEditingId(null)
    setIsFormOpen(false)
  }

  function decide(approval: '승인' | '반려') {
    if (!selectedRequest || !currentStep || !canDecide) return

    setRequests((current) =>
      current.map((request) => {
        if (request.id !== selectedRequest.id) return request
        const stepIndex = request.steps.findIndex((step) => step.status === '결재 중')
        const steps = request.steps.map((step, index) =>
          index === stepIndex ? { ...step, status: approval, date: today() } : step,
        )
        if (approval === '승인' && stepIndex + 1 < steps.length) {
          steps[stepIndex + 1] = { ...steps[stepIndex + 1], status: '결재 중' }
        }
        return { ...request, steps, status: deriveStatus(steps) }
      }),
    )

    if (approval === '반려') setNotice('반려했습니다. 기안자가 수정 후 다시 상신할 수 있습니다.')
    else if (currentStep.kind === '지출 처리') setNotice('지출 처리를 완료했습니다.')
    else setNotice('결재를 승인했습니다.')
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="워크플로 홈">
          <span className="brand-mark">w</span>
          <span>워크플로<span className="brand-dot">.</span></span>
        </a>
        <div className="workspace-switch">
          <span className="workspace-icon">S</span>
          <span className="workspace-name">소피아</span>
        </div>
        <div className="nav-label">워크스페이스</div>
        <nav className="main-nav" aria-label="주 메뉴">
          <button className="nav-item" type="button"><span>▦</span> 대시보드</button>
          <button className="nav-item active" type="button"><span>▤</span> 지출품의</button>
          <button className="nav-item" type="button"><span>◷</span> 내 결재함 <span className="nav-count">{waitingCount}</span></button>
          <button className="nav-item" type="button"><span>▧</span> 지출 현황</button>
        </nav>
        <div className="sidebar-spacer" />
        <div className="nav-label">관리</div>
        <nav className="main-nav" aria-label="관리 메뉴">
          <button className="nav-item" type="button"><span>⚙</span> 사용자·직책</button>
          <button className="nav-item" type="button"><span>?</span> 도움말</button>
        </nav>
        <div className="sidebar-user">
          <span className="avatar avatar-purple">{activeUser.slice(0, 1)}</span>
          <span className="sidebar-user-copy"><strong>{activeUser}</strong><small>{activePerson.department} {activePerson.position}</small></span>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>행정</span><span className="crumb-separator">/</span><strong>지출품의</strong></div>
          <div className="topbar-actions">
            <span className="demo-label">시연용 사용자</span>
            <label className="sr-only" htmlFor="active-user">시연 사용자 선택</label>
            <select id="active-user" className="user-switcher" value={activeUser} onChange={(event) => setActiveUser(event.currentTarget.value)}>
              {people.map((person) => (
                <option key={person.name} value={person.name}>{person.name} · {person.department} {person.position}</option>
              ))}
            </select>
            <span className="avatar avatar-purple top-avatar">{activeUser.slice(0, 1)}</span>
          </div>
        </header>

        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">EXPENSE APPROVAL</div>
              <h1>지출품의</h1>
              <p>기안 → 기관장 확인 → 교장 결재 → 행정실장 지출 처리까지 한곳에서 관리하세요.</p>
            </div>
            <button className="primary-button" type="button" onClick={openNewForm}>
              <span className="plus">＋</span> 새 지출품의
            </button>
          </div>

          <div className="demo-notice">
            <span className="notice-icon">i</span>
            <span><strong>인터랙티브 시연 화면</strong> · 로그인/서버 저장은 아직 없으며, 상단에서 현재 결재자를 선택해 결재를 시연하세요. 이름은 모두 가상입니다.</span>
            <button type="button" aria-label="안내 닫기" onClick={(event) => event.currentTarget.parentElement?.remove()}>×</button>
          </div>

          <section className="summary-grid" aria-label="지출품의 요약">
            <article className="summary-card">
              <div className="summary-top"><span>내 처리 대기</span><span className="summary-icon icon-yellow">◷</span></div>
              <strong className="summary-value">{waitingCount}<small>건</small></strong>
              <span className="summary-foot">내가 결재하거나 지출 처리할 요청</span>
            </article>
            <article className="summary-card">
              <div className="summary-top"><span>결재 진행 중</span><span className="summary-icon icon-blue">↗</span></div>
              <strong className="summary-value">{inProgressCount}<small>건</small></strong>
              <span className="summary-foot">기관장·교장 결재가 진행 중</span>
            </article>
            <article className="summary-card">
              <div className="summary-top"><span>지출 대기</span><span className="summary-icon icon-purple">₩</span></div>
              <strong className="summary-value">{payoutWaitingCount}<small>건</small></strong>
              <span className="summary-foot">교장 결재 후 행정실장 지출 대기</span>
            </article>
            <article className="summary-card">
              <div className="summary-top"><span>지출 완료 금액</span><span className="summary-icon icon-green">✓</span></div>
              <strong className="summary-value amount-value">₩ {formatCurrency(paidAmount)}</strong>
              <span className="summary-foot">지출 완료 {paidRequests.length}건 합계</span>
            </article>
          </section>

          <section className="requests-panel">
            <div className="panel-heading">
              <div>
                <h2>지출품의 목록</h2>
                <p>요청 내역을 확인하고 결재를 진행하세요.</p>
              </div>
              <div className="list-actions">
                <label className="search-box">
                  <span aria-hidden="true">⌕</span>
                  <input value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="품의명, 기안자, 부서 검색" aria-label="품의명, 기안자 또는 부서 검색" />
                </label>
                <label className="sr-only" htmlFor="department-filter">부서 필터</label>
                <select id="department-filter" className="department-filter" value={departmentFilter} onChange={(event) => setDepartmentFilter(event.currentTarget.value)}>
                  <option>전체 부서</option>
                  {departments.map((department) => <option key={department}>{department}</option>)}
                </select>
              </div>
            </div>

            <div className="filter-tabs" role="tablist" aria-label="상태별 필터">
              {filters.map((filter) => (
                <button key={filter} className={`filter-tab ${activeFilter === filter ? 'selected' : ''}`} type="button" role="tab" aria-selected={activeFilter === filter} onClick={() => setActiveFilter(filter)}>
                  {filter === '전체' ? '전체 품의' : filter}
                  {filter === '전체' && <span className="tab-count">{requests.length}</span>}
                </button>
              ))}
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">품의명</th>
                    <th scope="col">기안자</th>
                    <th scope="col">기안일</th>
                    <th scope="col">금액</th>
                    <th scope="col">상태</th>
                    <th scope="col"><span className="sr-only">상세 보기</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.map((request) => (
                    <tr key={request.id} className={selectedId === request.id ? 'row-selected' : ''} onClick={() => setSelectedId(request.id)}>
                      <td>
                        <button className="request-title" type="button" onClick={() => setSelectedId(request.id)}>
                          <strong>{request.title}</strong><small>{request.code} <span>·</span> {request.category}</small>
                        </button>
                      </td>
                      <td><span className="requester-cell"><span className="avatar avatar-small">{request.requester.slice(0, 1)}</span>{request.requester} <small className="dept-tag">{request.department}</small></span></td>
                      <td className="date-cell">{request.date}</td>
                      <td className="amount-cell">₩ {formatCurrency(request.amount)}</td>
                      <td><StatusBadge status={request.status} /></td>
                      <td className="row-arrow">›</td>
                    </tr>
                  ))}
                  {filteredRequests.length === 0 && (
                    <tr><td className="empty-state" colSpan={6}>조건에 맞는 지출품의가 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="table-footer"><span>총 <strong>{filteredRequests.length}</strong>건</span></div>
          </section>

          {selectedRequest && (
            <section className="detail-panel">
              <div className="detail-heading">
                <div>
                  <div className="detail-kicker">{selectedRequest.code}<span className="detail-dot">·</span><StatusBadge status={selectedRequest.status} /></div>
                  <h2>{selectedRequest.title}</h2>
                  <p>{selectedRequest.requester} · {selectedRequest.department} · {selectedRequest.date}</p>
                </div>
                {canDecide && currentStep && (
                  <div className="decision-actions">
                    <button className="reject-button" type="button" onClick={() => decide('반려')}>반려</button>
                    <button className="approve-button" type="button" onClick={() => decide('승인')}>
                      {currentStep.kind === '지출 처리' ? '지출 완료 처리' : '승인하기'} <span>→</span>
                    </button>
                  </div>
                )}
                {canResubmit && (
                  <div className="decision-actions">
                    <button className="approve-button" type="button" onClick={() => openEditForm(selectedRequest)}>수정 후 재상신 <span>→</span></button>
                  </div>
                )}
              </div>
              <div className="detail-content">
                <div className="request-info">
                  <h3>요청 정보</h3>
                  <div className="info-grid">
                    <div><span>요청 금액</span><strong className="detail-amount">₩ {formatCurrency(selectedRequest.amount)}</strong></div>
                    <div><span>비용 항목</span><strong>{selectedRequest.category}</strong></div>
                    <div className="memo-info"><span>사용 목적</span><strong>{selectedRequest.memo || '기재된 메모가 없습니다.'}</strong></div>
                  </div>
                </div>
                <div className="approval-flow">
                  <h3>결재선</h3>
                  <div className="approval-steps">
                    {selectedRequest.steps.map((step, index) => (
                      <div className="approval-step" key={`${step.name}-${step.kind}`}>
                        <span className={`step-avatar step-${slug(step.status)}`}>{step.status === '승인' ? '✓' : step.status === '반려' ? '×' : step.name.slice(0, 1)}</span>
                        <div className="step-copy"><strong>{step.name}</strong><span>{step.kind} · {step.position}</span></div>
                        <span className={`step-state step-state-${slug(step.status)}`}>{stepStateLabel(step)}</span>
                        {index < selectedRequest.steps.length - 1 && <span className="step-connector" />}
                      </div>
                    ))}
                  </div>
                  {canDecide && <p className="action-hint">현재 시연 사용자가 처리할 차례입니다.</p>}
                </div>
              </div>
            </section>
          )}
        </div>
      </main>

      {notice && <div className="toast" role="status"><span>✓</span>{notice}<button type="button" aria-label="알림 닫기" onClick={() => setNotice('')}>×</button></div>}

      {isFormOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsFormOpen(false) }}>
          <section className="request-modal" role="dialog" aria-modal="true" aria-labelledby="form-title">
            <div className="modal-heading">
              <div><span className="eyebrow">{editingId === null ? 'NEW EXPENSE REQUEST' : 'RESUBMIT'}</span><h2 id="form-title">{editingId === null ? '새 지출품의' : '지출품의 수정 후 재상신'}</h2><p>{activePerson.department} · {activePerson.name} 기안</p></div>
              <button className="modal-close" type="button" aria-label="닫기" onClick={() => setIsFormOpen(false)}>×</button>
            </div>
            <form onSubmit={submitRequest}>
              <label className="form-field"><span>품의 제목 <i>*</i></span><input name="title" value={form.title} onChange={updateForm} placeholder="예: 현장학습 버스 대절" required maxLength={80} /></label>
              <div className="form-row">
                <label className="form-field"><span>비용 항목 <i>*</i></span><select name="category" value={form.category} onChange={updateForm}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
                <label className="form-field"><span>요청 금액 <i>*</i></span><div className="currency-input"><span>₩</span><input name="amount" type="number" min="1" step="1" value={form.amount} onChange={updateForm} placeholder="0" required /></div></label>
              </div>
              <label className="form-field"><span>사용 목적 및 메모</span><textarea name="memo" value={form.memo} onChange={updateForm} placeholder="지출이 필요한 이유를 입력해 주세요." rows={3} maxLength={500} /></label>
              <div className="approval-form-section">
                <div className="form-section-heading"><span>결재선 (자동 지정)</span><small>기안자의 부서 기준으로 정해집니다.</small></div>
                <ol className="preview-steps">
                  {previewSteps.map((step) => <li key={step.kind}><strong>{step.name}</strong> <span>{step.kind} · {step.position}</span></li>)}
                </ol>
              </div>
              <div className="modal-footer"><button className="cancel-button" type="button" onClick={() => setIsFormOpen(false)}>취소</button><button className="primary-button" type="submit">{editingId === null ? '결재 요청' : '재상신'} <span>→</span></button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
