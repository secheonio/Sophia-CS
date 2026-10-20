import { useState, type ChangeEvent, type FormEvent } from 'react'
import './App.css'

type ApprovalStatus = '대기' | '결재 중' | '승인' | '반려'
type RequestStatus = '결재 중' | '승인 완료' | '반려'
type FilterStatus = '전체' | RequestStatus

interface ApprovalStep {
  name: string
  role: string
  status: ApprovalStatus
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

const people = [
  { name: '김민지', role: '기안자', department: '마케팅팀' },
  { name: '박서준', role: '팀장', department: '마케팅팀' },
  { name: '최유진', role: '재무팀장', department: '재무팀' },
]

const initialRequests: ExpenseRequest[] = [
  {
    id: 4,
    code: 'EXP-2026-004',
    title: '신제품 촬영 스튜디오 대관',
    requester: '김민지',
    department: '마케팅팀',
    category: '광고·홍보비',
    amount: 850000,
    date: '2026-10-19',
    status: '결재 중',
    memo: '10월 신제품 상세 페이지 촬영을 위한 스튜디오 대관료입니다.',
    steps: [
      { name: '박서준', role: '팀장', status: '결재 중' },
      { name: '최유진', role: '재무팀장', status: '대기' },
    ],
  },
  {
    id: 3,
    code: 'EXP-2026-003',
    title: '고객 인터뷰 교통비',
    requester: '김민지',
    department: '마케팅팀',
    category: '여비교통비',
    amount: 126000,
    date: '2026-10-18',
    status: '결재 중',
    memo: '고객 인터뷰 참석자 3인의 교통비입니다.',
    steps: [
      { name: '박서준', role: '팀장', status: '승인', date: '2026-10-18' },
      { name: '최유진', role: '재무팀장', status: '결재 중' },
    ],
  },
  {
    id: 2,
    code: 'EXP-2026-002',
    title: '디자인 툴 연간 구독',
    requester: '이도윤',
    department: '디자인팀',
    category: '소프트웨어',
    amount: 420000,
    date: '2026-10-16',
    status: '승인 완료',
    memo: '디자인 협업 도구 1년 구독 갱신 비용입니다.',
    steps: [
      { name: '박서준', role: '팀장', status: '승인', date: '2026-10-16' },
      { name: '최유진', role: '재무팀장', status: '승인', date: '2026-10-17' },
    ],
  },
  {
    id: 1,
    code: 'EXP-2026-001',
    title: '팀 워크숍 식대',
    requester: '김민지',
    department: '마케팅팀',
    category: '복리후생비',
    amount: 310000,
    date: '2026-10-15',
    status: '반려',
    memo: '팀 워크숍 점심 식대입니다.',
    steps: [
      { name: '박서준', role: '팀장', status: '반려', date: '2026-10-15' },
      { name: '최유진', role: '재무팀장', status: '대기' },
    ],
  },
]

const filters: FilterStatus[] = ['전체', '결재 중', '승인 완료', '반려']
const categories = ['광고·홍보비', '여비교통비', '소프트웨어', '복리후생비', '비품·소모품', '기타']

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('ko-KR').format(amount)
}

function StatusBadge({ status }: { status: RequestStatus }) {
  return <span className={`status-badge status-${status.replaceAll(' ', '-')}`}>{status}</span>
}

function App() {
  const [requests, setRequests] = useState(initialRequests)
  const [selectedId, setSelectedId] = useState(4)
  const [activeFilter, setActiveFilter] = useState<FilterStatus>('전체')
  const [activeUser, setActiveUser] = useState('김민지')
  const [search, setSearch] = useState('')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState({
    title: '',
    category: categories[0],
    amount: '',
    memo: '',
    firstApprover: '박서준',
    secondApprover: '최유진',
  })

  const activePerson = people.find((person) => person.name === activeUser)
  const selectedRequest = requests.find((request) => request.id === selectedId)
  const filteredRequests = requests.filter((request) => {
    const matchesFilter = activeFilter === '전체' || request.status === activeFilter
    const query = search.trim().toLocaleLowerCase()
    const matchesSearch =
      query.length === 0 ||
      `${request.code} ${request.title} ${request.requester} ${request.department}`
        .toLocaleLowerCase()
        .includes(query)
    return matchesFilter && matchesSearch
  })
  const waitingCount = requests.filter(
    (request) =>
      request.status === '결재 중' &&
      request.steps.some((step) => step.name === activeUser && step.status === '결재 중'),
  ).length
  const inProgressCount = requests.filter((request) => request.status === '결재 중').length
  const completedCount = requests.filter((request) => request.status === '승인 완료').length
  const currentStep = selectedRequest?.steps.find((step) => step.status === '결재 중')
  const canDecide =
    selectedRequest?.status === '결재 중' && currentStep?.name === activeUser

  function updateForm(event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value } = event.currentTarget
    setForm((current) => ({ ...current, [name]: value }))
  }

  function changeActiveUser(event: ChangeEvent<HTMLSelectElement>) {
    const name = event.currentTarget.value
    const approvers = people.filter((person) => person.name !== name)
    setActiveUser(name)
    if (approvers.length >= 2) {
      setForm((current) => ({
        ...current,
        firstApprover: approvers[0].name,
        secondApprover: approvers[1].name,
      }))
    }
  }

  function createRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const amount = Number(form.amount)
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setNotice('금액은 1원 이상의 정수로 입력해 주세요.')
      return
    }

    const nextId = Math.max(...requests.map((request) => request.id)) + 1
    const newRequest: ExpenseRequest = {
      id: nextId,
      code: `EXP-${new Date().getFullYear()}-${String(nextId).padStart(3, '0')}`,
      title: form.title.trim(),
      requester: activeUser,
      department: people.find((person) => person.name === activeUser)?.department ?? '미지정',
      category: form.category,
      amount,
      date: new Date().toISOString().slice(0, 10),
      status: '결재 중',
      memo: form.memo.trim(),
      steps: [
        {
          name: form.firstApprover,
          role: people.find((person) => person.name === form.firstApprover)?.role ?? '결재자',
          status: '결재 중',
        },
        {
          name: form.secondApprover,
          role: people.find((person) => person.name === form.secondApprover)?.role ?? '결재자',
          status: '대기',
        },
      ],
    }

    setRequests((current) => [newRequest, ...current])
    setSelectedId(nextId)
    setActiveFilter('전체')
    setForm({
      title: '',
      category: categories[0],
      amount: '',
      memo: '',
      firstApprover: '박서준',
      secondApprover: '최유진',
    })
    setIsFormOpen(false)
    setNotice('새 지출품의를 결재 요청했습니다.')
  }

  function decide(approval: '승인' | '반려') {
    if (!selectedRequest || !currentStep || !canDecide) return

    setRequests((current) =>
      current.map((request) => {
        if (request.id !== selectedRequest.id) return request
        const stepIndex = request.steps.findIndex((step) => step.status === '결재 중')
        const steps = request.steps.map((step, index) =>
          index === stepIndex
            ? { ...step, status: approval, date: new Date().toISOString().slice(0, 10) }
            : step,
        )

        if (approval === '반려') {
          return { ...request, status: '반려', steps }
        }

        const nextStepIndex = stepIndex + 1
        if (nextStepIndex >= steps.length) {
          return { ...request, status: '승인 완료', steps }
        }

        steps[nextStepIndex] = { ...steps[nextStepIndex], status: '결재 중' }
        return { ...request, steps }
      }),
    )
    setNotice(approval === '승인' ? '결재를 승인했습니다.' : '결재를 반려했습니다.')
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
          <span className="workspace-name">소피아 컴퍼니</span>
          <span className="chevron">⌄</span>
        </div>
        <div className="nav-label">워크스페이스</div>
        <nav className="main-nav" aria-label="주 메뉴">
          <button className="nav-item" type="button"><span>▦</span> 대시보드</button>
          <button className="nav-item active" type="button"><span>▤</span> 지출품의</button>
          <button className="nav-item" type="button"><span>◷</span> 내 결재함 <span className="nav-count">{waitingCount}</span></button>
          <button className="nav-item" type="button"><span>▧</span> 비용 리포트</button>
        </nav>
        <div className="sidebar-spacer" />
        <div className="nav-label">관리</div>
        <nav className="main-nav" aria-label="관리 메뉴">
          <button className="nav-item" type="button"><span>⚙</span> 설정</button>
          <button className="nav-item" type="button"><span>?</span> 도움말</button>
        </nav>
        <div className="sidebar-user">
          <span className="avatar avatar-purple">{activeUser.slice(0, 1)}</span>
          <span className="sidebar-user-copy"><strong>{activeUser}</strong><small>{activePerson?.department} {activePerson?.role}</small></span>
          <span className="chevron">···</span>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>재무</span><span className="crumb-separator">/</span><strong>지출품의</strong></div>
          <div className="topbar-actions">
            <span className="demo-label">시연용 사용자</span>
            <label className="sr-only" htmlFor="active-user">시연 사용자 선택</label>
            <select
              id="active-user"
              className="user-switcher"
              value={activeUser}
              onChange={changeActiveUser}
            >
              {people.map((person) => <option key={person.name} value={person.name}>{person.name} · {person.role}</option>)}
            </select>
            <button className="icon-button notification-button" type="button" aria-label="알림">♧<i /></button>
            <span className="avatar avatar-purple top-avatar">{activeUser.slice(0, 1)}</span>
          </div>
        </header>

        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">FINANCE WORKSPACE</div>
              <h1>지출품의</h1>
              <p>비용 요청부터 최종 승인까지, 한곳에서 관리하세요.</p>
            </div>
            <button className="primary-button" type="button" onClick={() => { setNotice(''); setIsFormOpen(true) }}>
              <span className="plus">＋</span> 새 지출품의
            </button>
          </div>

          <div className="demo-notice">
            <span className="notice-icon">i</span>
            <span><strong>인터랙티브 시연 화면</strong> · 로그인/서버 저장은 아직 없으며, 결재하려면 상단에서 현재 결재자를 선택하세요.</span>
            <button type="button" aria-label="안내 닫기" onClick={(event) => event.currentTarget.parentElement?.remove()}>×</button>
          </div>

          <section className="summary-grid" aria-label="지출품의 요약">
            <article className="summary-card">
              <div className="summary-top"><span>내 결재 대기</span><span className="summary-icon icon-yellow">◷</span></div>
              <strong className="summary-value">{waitingCount}<small>건</small></strong>
              <span className="summary-foot">내 승인을 기다리는 요청</span>
            </article>
            <article className="summary-card">
              <div className="summary-top"><span>진행 중인 품의</span><span className="summary-icon icon-blue">↗</span></div>
              <strong className="summary-value">{inProgressCount}<small>건</small></strong>
              <span className="summary-foot">결재가 진행 중인 요청</span>
            </article>
            <article className="summary-card">
              <div className="summary-top"><span>이번 달 승인</span><span className="summary-icon icon-green">✓</span></div>
              <strong className="summary-value">{completedCount}<small>건</small></strong>
              <span className="summary-foot">최종 승인이 완료된 요청</span>
            </article>
            <article className="summary-card budget-card">
              <div className="summary-top"><span>이번 달 승인 금액</span><span className="summary-icon icon-purple">₩</span></div>
              <strong className="summary-value amount-value">₩ 420,000</strong>
              <span className="summary-foot"><span className="trend">↗ 12.5%</span> 지난달 대비</span>
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
                  <input value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="품의명, 요청자 검색" aria-label="품의명 또는 요청자 검색" />
                  <kbd>⌘ K</kbd>
                </label>
                <button className="filter-button" type="button" onClick={() => setActiveFilter(activeFilter === '전체' ? '결재 중' : '전체')}>☷ <span>필터</span></button>
              </div>
            </div>

            <div className="filter-tabs" role="tablist" aria-label="상태별 필터">
              {filters.map((filter) => (
                <button
                  key={filter}
                  className={`filter-tab ${activeFilter === filter ? 'selected' : ''}`}
                  type="button"
                  role="tab"
                  aria-selected={activeFilter === filter}
                  onClick={() => setActiveFilter(filter)}
                >
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
                    <th scope="col">요청자</th>
                    <th scope="col">요청일</th>
                    <th scope="col">금액</th>
                    <th scope="col">결재 상태</th>
                    <th scope="col"><span className="sr-only">상세 보기</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.map((request) => (
                    <tr
                      key={request.id}
                      className={selectedId === request.id ? 'row-selected' : ''}
                      onClick={() => setSelectedId(request.id)}
                    >
                      <td>
                        <button className="request-title" type="button" onClick={() => setSelectedId(request.id)}>
                          <strong>{request.title}</strong><small>{request.code} <span>·</span> {request.category}</small>
                        </button>
                      </td>
                      <td><span className="requester-cell"><span className="avatar avatar-small">{request.requester.slice(0, 1)}</span>{request.requester}</span></td>
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
            <div className="table-footer"><span>총 <strong>{filteredRequests.length}</strong>건</span><div className="pagination"><button type="button" disabled aria-label="이전 페이지">‹</button><button type="button" className="page-current">1</button><button type="button" disabled aria-label="다음 페이지">›</button></div></div>
          </section>

          {selectedRequest && (
            <section className="detail-panel">
              <div className="detail-heading">
                <div>
                  <div className="detail-kicker">{selectedRequest.code}<span className="detail-dot">·</span><StatusBadge status={selectedRequest.status} /></div>
                  <h2>{selectedRequest.title}</h2>
                  <p>{selectedRequest.requester} · {selectedRequest.department} · {selectedRequest.date}</p>
                </div>
                {canDecide && (
                  <div className="decision-actions">
                    <button className="reject-button" type="button" onClick={() => decide('반려')}>반려</button>
                    <button className="approve-button" type="button" onClick={() => decide('승인')}>승인하기 <span>→</span></button>
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
                      <div className="approval-step" key={`${step.name}-${index}`}>
                        <span className={`step-avatar step-${step.status.replaceAll(' ', '-')}`}>{step.status === '승인' ? '✓' : step.status === '반려' ? '×' : step.name.slice(0, 1)}</span>
                        <div className="step-copy"><strong>{step.name}</strong><span>{step.role}</span></div>
                        <span className={`step-state step-state-${step.status.replaceAll(' ', '-')}`}>{step.status}{step.date ? ` · ${step.date}` : ''}</span>
                        {index < selectedRequest.steps.length - 1 && <span className="step-connector" />}
                      </div>
                    ))}
                  </div>
                  {canDecide && <p className="action-hint">현재 시연 사용자가 결재할 차례입니다.</p>}
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
              <div><span className="eyebrow">NEW EXPENSE REQUEST</span><h2 id="form-title">새 지출품의</h2><p>지출 정보와 결재선을 입력해 주세요.</p></div>
              <button className="modal-close" type="button" aria-label="닫기" onClick={() => setIsFormOpen(false)}>×</button>
            </div>
            <form onSubmit={createRequest}>
              <label className="form-field"><span>품의 제목 <i>*</i></span><input name="title" value={form.title} onChange={updateForm} placeholder="예: 고객 미팅 식대" required maxLength={80} /></label>
              <div className="form-row">
                <label className="form-field"><span>비용 항목 <i>*</i></span><select name="category" value={form.category} onChange={updateForm}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
                <label className="form-field"><span>요청 금액 <i>*</i></span><div className="currency-input"><span>₩</span><input name="amount" type="number" min="1" step="1" value={form.amount} onChange={updateForm} placeholder="0" required /></div></label>
              </div>
              <label className="form-field"><span>사용 목적 및 메모</span><textarea name="memo" value={form.memo} onChange={updateForm} placeholder="지출이 필요한 이유를 입력해 주세요." rows={3} maxLength={500} /></label>
              <div className="approval-form-section"><div className="form-section-heading"><span>결재선</span><small>순서대로 결재가 진행됩니다.</small></div>
                <div className="form-row">
                  <label className="form-field"><span>1차 결재자</span><select name="firstApprover" value={form.firstApprover} onChange={updateForm}>{people.filter((person) => person.name !== activeUser && person.name !== form.secondApprover).map((person) => <option key={person.name} value={person.name}>{person.name} · {person.role}</option>)}</select></label>
                  <label className="form-field"><span>2차 결재자</span><select name="secondApprover" value={form.secondApprover} onChange={updateForm}>{people.filter((person) => person.name !== activeUser && person.name !== form.firstApprover).map((person) => <option key={person.name} value={person.name}>{person.name} · {person.role}</option>)}</select></label>
                </div>
              </div>
              <div className="modal-footer"><button className="cancel-button" type="button" onClick={() => setIsFormOpen(false)}>취소</button><button className="primary-button" type="submit">결재 요청 <span>→</span></button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
