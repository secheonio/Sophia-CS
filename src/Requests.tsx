import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { api, ApiError, attachmentUrl } from './api'
import type { ApprovalStep, ExpenseRequest, Meta, NewImage, RequestStatus, User } from './types'

type FilterStatus = '전체' | RequestStatus
const filters: FilterStatus[] = ['전체', '결재 중', '지출 대기', '지출 완료', '반려']
const launchDepartments = ['기초과정', '본과정', '심화과정', '생활관', '전형위원회', '교무부', '교육과정연구부', '생활교육부', '델포이', '행정실']
const launchDepartmentTones: Record<string, 'course' | 'institution' | 'department' | 'accounting'> = {
  기초과정: 'course',
  본과정: 'course',
  심화과정: 'course',
  생활관: 'institution',
  전형위원회: 'institution',
  교무부: 'department',
  교육과정연구부: 'department',
  생활교육부: 'department',
  델포이: 'institution',
  행정실: 'accounting',
}

type BudgetRow = {
  관: string
  항: string
  목: string
  세목: string
  내역: string
  예산총액: number
  예산잔액: number
  집행률: number
}

const emptyForm = { title: '', category: '', amount: '', memo: '', department: '', budgetGwan: '', budgetHang: '', budgetMok: '', budgetSemok: '', budgetNae: '' }

function pickDefaultDepartment(user: User, departments: string[]) {
  const validCurrent = user.department && departments.includes(user.department) && user.department !== '교장' && user.department !== '행정실'
  if (validCurrent) return user.department
  return departments.find((department) => department !== '교장' && department !== '행정실') ?? departments[0]
}

interface DraftImage { key: string; name: string; src: string; attachmentId?: number; dataUrl?: string }

const formatCurrency = (amount: number) => new Intl.NumberFormat('ko-KR').format(amount)
const slug = (value: string) => value.replaceAll(' ', '-')

function stepStateLabel(step: { status: string; kind: string; date?: string | null }) {
  const isFinalizedPayment = step.status === '승인' && (
    step.kind === '교장 결재, 지출처리 요청' ||
    step.kind === '교장 결재 대기중' ||
    step.kind === '행정실장 지출처리' ||
    step.kind === '행정실장 경유'
  )
  const label = isFinalizedPayment ? '지출 완료' : step.status
  return step.date ? `${label} · ${step.date}` : label
}

function StatusBadge({ status }: { status: RequestStatus }) {
  return <span className={`status-badge status-${slug(status)}`}>{status}</span>
}

function readImage(file: File): Promise<DraftImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({ key: crypto.randomUUID(), name: file.name, src: String(reader.result), dataUrl: String(reader.result) })
    reader.onerror = () => reject(new Error(`${file.name} 파일을 읽지 못했습니다.`))
    reader.readAsDataURL(file)
  })
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

export function Requests({ user, meta, inboxOnly, onWaitingCount, notify, onError }: {
  user: User
  meta: Meta
  inboxOnly: boolean
  onWaitingCount: (count: number) => void
  notify: (message: string) => void
  onError: (message: string) => void
}) {
  const [requests, setRequests] = useState<ExpenseRequest[]>([])
  const [loaded, setLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [activeFilter, setActiveFilter] = useState<FilterStatus>('전체')
  const [search, setSearch] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('전체 부서')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...emptyForm, category: meta.categories[0], department: pickDefaultDepartment(user, meta.departments) })
  const [selectedBudget, setSelectedBudget] = useState<BudgetRow | null>(null)
  const [images, setImages] = useState<DraftImage[]>([])
  const budgetCatalog = meta.budgetCatalog ?? {}
  const budgetRows = form.department ? (budgetCatalog[form.department] ?? []) : []
  const [formError, setFormError] = useState('')
  const [preview, setPreview] = useState<ApprovalStep[]>([])
  const [previewError, setPreviewError] = useState('')
  const [busy, setBusy] = useState(false)
  const [isRejecting, setIsRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [viewer, setViewer] = useState<{ name: string; src: string } | null>(null)

  const refresh = useCallback(async () => {
    try {
      setRequests((await api.requests()).requests)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 0) return
      if (caught instanceof ApiError && caught.status === 401) return
      onError(caught instanceof ApiError ? caught.message : '목록을 불러오지 못했습니다.')
    } finally {
      setLoaded(true)
    }
  }, [onError])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { if (!document.hidden) void refresh() }, 30000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const isWaitingForMe = useCallback(
    (request: ExpenseRequest) => request.steps.some((step) => step.userId === user.id && step.status === '결재 중'),
    [user.id],
  )
  const waitingCount = useMemo(() => requests.filter(isWaitingForMe).length, [requests, isWaitingForMe])
  useEffect(() => onWaitingCount(waitingCount), [waitingCount, onWaitingCount])

  const query = search.trim().toLocaleLowerCase()
  const listed = requests.filter((request) => {
    if (inboxOnly && !isWaitingForMe(request)) return false
    const matchesFilter = (activeFilter === '전체' || request.status === activeFilter) &&
      (departmentFilter === '전체 부서' || request.department === departmentFilter)
    const matchesSearch = query.length === 0 ||
      `${request.code} ${request.title} ${request.requester} ${request.department}`.toLocaleLowerCase().includes(query)
    return matchesFilter && matchesSearch
  })

  const selected = requests.find((request) => request.id === selectedId) ?? listed[0]
  const currentStep = selected?.steps.find((step) => step.status === '결재 중')
  const canDecide = currentStep?.userId === user.id
  const canResubmit = selected?.status === '반려' && selected.requesterId === user.id
  const inProgressCount = requests.filter((request) => request.status === '결재 중').length
  const payoutWaitingCount = requests.filter((request) => request.status === '지출 대기').length
  const paid = requests.filter((request) => request.status === '지출 완료')
  const paidAmount = paid.reduce((sum, request) => sum + request.amount, 0)

  function select(id: number) {
    setSelectedId(id)
    setIsRejecting(false)
    setRejectReason('')
  }

  async function openForm(request?: ExpenseRequest, preferredDepartment?: string) {
    setFormError('')
    setPreviewError('')
    setEditingId(request?.id ?? null)
    const nextDepartment = request?.department || preferredDepartment || pickDefaultDepartment(user, meta.departments)
    const initialBudget = budgetCatalog[nextDepartment]?.[0] ?? null
    setSelectedBudget(initialBudget)
    setForm(request
      ? {
          title: request.title,
          category: request.category,
          amount: String(request.amount),
          memo: request.memo,
          department: nextDepartment,
          budgetGwan: initialBudget?.관 ?? '',
          budgetHang: initialBudget?.항 ?? '',
          budgetMok: initialBudget?.목 ?? '',
          budgetSemok: initialBudget?.세목 ?? '',
          budgetNae: initialBudget?.내역 ?? '',
        }
      : {
          ...emptyForm,
          category: meta.categories[0],
          department: nextDepartment,
          budgetGwan: initialBudget?.관 ?? '',
          budgetHang: initialBudget?.항 ?? '',
          budgetMok: initialBudget?.목 ?? '',
          budgetSemok: initialBudget?.세목 ?? '',
          budgetNae: initialBudget?.내역 ?? '',
        })
    setImages(request
      ? request.attachments.map((item) => ({ key: `a${item.id}`, name: item.name, src: attachmentUrl(item.id), attachmentId: item.id }))
      : [])
    setPreview([])
    setIsFormOpen(true)
    try {
      setPreview((await api.preview(nextDepartment)).steps)
    } catch (caught) {
      setPreviewError(caught instanceof ApiError ? caught.message : '결재선을 확인하지 못했습니다.')
    }
  }

  function updateForm(event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value } = event.currentTarget
    setForm((current) => ({ ...current, [name]: value }))
    if (name === 'department' && value) {
      const nextRows = budgetCatalog[value] ?? []
      const nextSelection = nextRows[0] ?? null
      setSelectedBudget(nextSelection)
      setForm((current) => ({
        ...current,
        budgetGwan: nextSelection?.관 ?? '',
        budgetHang: nextSelection?.항 ?? '',
        budgetMok: nextSelection?.목 ?? '',
        budgetSemok: nextSelection?.세목 ?? '',
        budgetNae: nextSelection?.내역 ?? '',
      }))
      void (async () => {
        setPreview([])
        setPreviewError('')
        try {
          setPreview((await api.preview(value)).steps)
        } catch (caught) {
          setPreviewError(caught instanceof ApiError ? caught.message : '결재선을 확인하지 못했습니다.')
        }
      })()
    }
  }

  function pickBudgetRow(row: BudgetRow) {
    setSelectedBudget(row)
    setForm((current) => ({
      ...current,
      budgetGwan: row.관,
      budgetHang: row.항,
      budgetMok: row.목,
      budgetSemok: row.세목,
      budgetNae: row.내역,
    }))
  }

  async function addImages(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const files = Array.from(input.files ?? [])
    input.value = ''
    if (files.length === 0) return
    if (images.length + files.length > meta.maxAttachments) {
      setFormError(`이미지는 최대 ${meta.maxAttachments}장까지 첨부할 수 있습니다.`)
      return
    }
    const invalid = files.find((file) => !IMAGE_TYPES.includes(file.type) || file.size > meta.maxAttachmentBytes)
    if (invalid) {
      setFormError(`${invalid.name}: 5MB 이하의 PNG·JPG·GIF·WEBP 이미지만 첨부할 수 있습니다.`)
      return
    }
    try {
      const added = await Promise.all(files.map(readImage))
      setImages((current) => [...current, ...added])
      setFormError('')
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : '이미지를 첨부하지 못했습니다.')
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const amount = Number(form.amount)
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setFormError('금액은 1원 이상의 정수로 입력해 주세요.')
      return
    }
    const payload = {
      title: form.title.trim(),
      category: form.category,
      amount,
      memo: form.memo.trim(),
      department: form.department || user.department || meta.departments[0],
      budget: {
        관: form.budgetGwan.trim(),
        항: form.budgetHang.trim(),
        목: form.budgetMok.trim(),
        세목: form.budgetSemok.trim(),
        내역: form.budgetNae.trim(),
      },
      newAttachments: images.filter((image) => image.dataUrl).map<NewImage>((image) => ({ name: image.name, dataUrl: image.dataUrl! })),
      keepAttachmentIds: images.flatMap((image) => (image.attachmentId ? [image.attachmentId] : [])),
    }
    setBusy(true)
    try {
      const { request } = editingId === null ? await api.create(payload) : await api.resubmit(editingId, payload)
      setIsFormOpen(false)
      setActiveFilter('전체')
      setDepartmentFilter('전체 부서')
      select(request.id)
      notify(editingId === null ? '새 지출품의를 결재 요청했습니다.' : '수정한 지출품의를 다시 결재 요청했습니다.')
      await refresh()
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : '상신하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function decide(action: 'approve' | 'reject') {
    if (!selected || !currentStep || busy) return
    setBusy(true)
    try {
      await api.decide(selected.id, action, rejectReason.trim())
      setIsRejecting(false)
      setRejectReason('')
      notify(action === 'reject'
        ? '반려했습니다. 기안자가 수정 후 다시 상신할 수 있습니다.'
        : currentStep.kind === '교장 결재, 지출처리 요청' || currentStep.kind === '교장 결재 대기중' || currentStep.kind === '행정실장 지출처리'
          ? '지출 처리를 완료했습니다.'
          : '결재를 승인했습니다.')
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : '처리하지 못했습니다.')
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  return (
    <div className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">EXPENSE APPROVAL</div>
          <h1>{inboxOnly ? '내 결재함' : '지출품의'}</h1>
          <p>{inboxOnly
            ? '내가 지금 결재하거나 지출 처리할 차례인 품의입니다.'
            : '상신 단위를 선택해 바로 기안을 시작하세요.'}</p>
        </div>
      </div>

      {!inboxOnly && (
        <div className="department-launch-grid" aria-label="상신 단위 선택">
          {launchDepartments.map((department) => (
            <button
              key={department}
              type="button"
              className={`department-launch-button department-launch-${launchDepartmentTones[department]}`}
              onClick={() => void openForm(undefined, department)}
            >
              {department}
            </button>
          ))}
        </div>
      )}

      <section className="summary-grid" aria-label="지출품의 요약">
        <article className="summary-card"><div className="summary-top"><span>내 처리 대기</span><span className="summary-icon icon-yellow">◷</span></div><strong className="summary-value">{waitingCount}<small>건</small></strong><span className="summary-foot">내가 결재하거나 지출 처리할 요청</span></article>
        <article className="summary-card"><div className="summary-top"><span>결재 진행 중</span><span className="summary-icon icon-blue">↗</span></div><strong className="summary-value">{inProgressCount}<small>건</small></strong><span className="summary-foot">기관장·교장 결재가 진행 중</span></article>
        <article className="summary-card"><div className="summary-top"><span>지출 대기</span><span className="summary-icon icon-purple">₩</span></div><strong className="summary-value">{payoutWaitingCount}<small>건</small></strong><span className="summary-foot">교장 결재 후 행정실장 지출 대기</span></article>
        <article className="summary-card"><div className="summary-top"><span>지출 완료 금액</span><span className="summary-icon icon-green">✓</span></div><strong className="summary-value amount-value">₩ {formatCurrency(paidAmount)}</strong><span className="summary-foot">지출 완료 {paid.length}건 합계</span></article>
      </section>

      <section className="requests-panel">
        <div className="panel-heading">
          <div><h2>지출품의 목록</h2><p>본인이 기안했거나 결재선에 포함된 품의만 표시됩니다.</p></div>
          <div className="list-actions">
            <label className="search-box"><span aria-hidden="true">⌕</span>
              <input value={search} onChange={(e) => setSearch(e.currentTarget.value)} placeholder="품의명, 기안자, 부서 검색" aria-label="품의명, 기안자 또는 부서 검색" />
            </label>
            <label className="sr-only" htmlFor="department-filter">부서 필터</label>
            <select id="department-filter" className="department-filter" value={departmentFilter} onChange={(e) => setDepartmentFilter(e.currentTarget.value)}>
              <option>전체 부서</option>
              {meta.departments.map((department) => <option key={department}>{department}</option>)}
            </select>
          </div>
        </div>

        <div className="filter-tabs" role="tablist" aria-label="상태별 필터">
          {filters.map((filter) => (
            <button key={filter} className={`filter-tab ${activeFilter === filter ? 'selected' : ''}`} type="button" role="tab" aria-selected={activeFilter === filter} onClick={() => setActiveFilter(filter)}>
              {filter === '전체' ? '전체 품의' : filter}
            </button>
          ))}
        </div>

        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">품의명</th><th scope="col">기안자</th><th scope="col">기안일</th><th scope="col">금액</th><th scope="col">상태</th><th scope="col"><span className="sr-only">상세 보기</span></th></tr></thead>
            <tbody>
              {listed.map((request) => (
                <tr key={request.id} className={selected?.id === request.id ? 'row-selected' : ''} onClick={() => select(request.id)}>
                  <td><button className="request-title" type="button" onClick={() => select(request.id)}><strong>{request.title}</strong><small>{request.code} <span>·</span> {request.category}</small></button></td>
                  <td><span className="requester-cell"><span className="avatar avatar-small">{request.requester.slice(0, 1)}</span>{request.requester} <small className="dept-tag">{request.department}</small></span></td>
                  <td className="date-cell">{request.date}</td>
                  <td className="amount-cell">₩ {formatCurrency(request.amount)}</td>
                  <td><StatusBadge status={request.status} /></td>
                  <td className="row-arrow">›</td>
                </tr>
              ))}
              {listed.length === 0 && (
                <tr><td className="empty-state" colSpan={6}>{!loaded ? '불러오는 중…' : '조건에 맞는 지출품의가 없습니다.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="table-footer"><span>총 <strong>{listed.length}</strong>건</span></div>
      </section>

      {selected && (
        <section className="detail-panel">
          <div className="detail-heading">
            <div>
              <div className="detail-kicker">{selected.code}<span className="detail-dot">·</span><StatusBadge status={selected.status} /></div>
              <h2>{selected.title}</h2>
              <p>{selected.requester} · {selected.department} · {selected.date}</p>
            </div>
            {canDecide && currentStep && !isRejecting && (
              <div className="decision-actions">
                <button className="reject-button" type="button" disabled={busy} onClick={() => setIsRejecting(true)}>반려</button>
                <button className="approve-button" type="button" disabled={busy} onClick={() => void decide('approve')}>
                  {currentStep.kind === '교장 결재, 지출처리 요청' || currentStep.kind === '교장 결재 대기중' || currentStep.kind === '행정실장 지출처리' ? '지출 완료 처리' : '승인하기'} <span>→</span>
                </button>
              </div>
            )}
            {canResubmit && (
              <div className="decision-actions"><button className="approve-button" type="button" onClick={() => void openForm(selected)}>수정 후 재상신 <span>→</span></button></div>
            )}
          </div>
          {canDecide && isRejecting && (
            <div className="reject-panel">
              <label htmlFor="reject-reason">반려 사유 <i>*</i></label>
              <textarea id="reject-reason" value={rejectReason} onChange={(e) => setRejectReason(e.currentTarget.value)} rows={3} maxLength={300} placeholder="기안자가 수정할 수 있도록 반려 사유를 구체적으로 입력해 주세요." autoFocus />
              <div className="reject-actions">
                <button className="cancel-button" type="button" onClick={() => { setIsRejecting(false); setRejectReason('') }}>취소</button>
                <button className="reject-confirm" type="button" disabled={busy || rejectReason.trim().length === 0} onClick={() => void decide('reject')}>반려 확정</button>
              </div>
            </div>
          )}
          {selected.status === '반려' && selected.rejection && (
            <div className="rejection-note" role="note">
              <strong>반려 사유</strong>
              <p>{selected.rejection.reason}</p>
              <small>{selected.rejection.by} · {selected.rejection.date}</small>
            </div>
          )}
          <div className="detail-content">
            <div className="request-info">
              <h3>요청 정보</h3>
              <div className="info-grid">
                <div><span>요청 금액</span><strong className="detail-amount">₩ {formatCurrency(selected.amount)}</strong></div>
                <div><span>비용 항목</span><strong>{selected.category}</strong></div>
                <div className="memo-info"><span>사용 목적</span><strong>{selected.memo || '기재된 메모가 없습니다.'}</strong></div>
                <div className="memo-info">
                  <span>첨부 이미지 ({selected.attachments.length})</span>
                  {selected.attachments.length === 0 ? <strong>첨부된 이미지가 없습니다.</strong> : (
                    <div className="thumb-grid">
                      {selected.attachments.map((attachment) => (
                        <button key={attachment.id} type="button" className="thumb" onClick={() => setViewer({ name: attachment.name, src: attachmentUrl(attachment.id) })} aria-label={`${attachment.name} 크게 보기`}>
                          <img src={attachmentUrl(attachment.id)} alt={attachment.name} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="approval-flow">
              <h3>결재선</h3>
              <div className="approval-steps">
                {selected.steps.map((step, index) => (
                  <div className="approval-step" key={`${step.userId}-${step.kind}`}>
                    <span className={`step-avatar step-${slug(step.status)}`}>{step.status === '승인' ? '✓' : step.status === '반려' ? '×' : step.name.slice(0, 1)}</span>
                    <div className="step-copy"><strong>{step.name}</strong><span>{step.kind} · {step.position}</span></div>
                    <span className={`step-state step-state-${slug(step.status)}`}>{stepStateLabel(step)}</span>
                    {index < selected.steps.length - 1 && <span className="step-connector" />}
                  </div>
                ))}
              </div>
              {canDecide && <p className="action-hint">지금 내가 처리할 차례입니다.</p>}
            </div>
          </div>
        </section>
      )}

      {viewer && (
        <div className="modal-backdrop image-viewer" onClick={() => setViewer(null)}>
          <figure role="dialog" aria-modal="true" aria-label={viewer.name}>
            <img src={viewer.src} alt={viewer.name} />
            <figcaption>{viewer.name} <button type="button" onClick={() => setViewer(null)}>닫기</button></figcaption>
          </figure>
        </div>
      )}

      {isFormOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsFormOpen(false) }}>
          <section className="request-modal" role="dialog" aria-modal="true" aria-labelledby="form-title">
            <div className="modal-heading">
              <div><span className="eyebrow">{editingId === null ? 'NEW EXPENSE REQUEST' : 'RESUBMIT'}</span><h2 id="form-title">{editingId === null ? '새 지출품의' : '지출품의 수정 후 재상신'}</h2><p>{user.department} · {user.name} 기안</p></div>
              <button className="modal-close" type="button" aria-label="닫기" onClick={() => setIsFormOpen(false)}>×</button>
            </div>
            <form onSubmit={(event) => void submit(event)}>
              <div className="approval-form-section">
                <div className="form-section-heading"><span>예산 항목 선택</span><small>클릭한 행의 관·항·목·세목·내역이 자동 입력됩니다.</small></div>
                {form.department && budgetRows.length > 0 && (
                  <div className="budget-table-wrap">
                    <table className="budget-table">
                      <thead>
                        <tr>
                          <th>관</th>
                          <th>항</th>
                          <th>목</th>
                          <th>세목</th>
                          <th>내역</th>
                          <th>예산 총액</th>
                          <th>예산 잔액</th>
                          <th>집행률</th>
                        </tr>
                      </thead>
                      <tbody>
                        {budgetRows.map((row) => {
                          const isSelected = selectedBudget === row || (
                            !selectedBudget &&
                            row.관 === form.budgetGwan &&
                            row.항 === form.budgetHang &&
                            row.목 === form.budgetMok &&
                            row.세목 === form.budgetSemok &&
                            row.내역 === form.budgetNae
                          )
                          const total = Number(row.예산총액 ?? 0)
                          const balance = Number(row.예산잔액 ?? 0)
                          const rate = total > 0 ? Math.min(100, Math.max(0, ((total - balance) / total) * 100)) : 0
                          return (
                            <tr key={`${row.관}-${row.항}-${row.목}-${row.세목}-${row.내역}`} className={isSelected ? 'selected-budget-row' : ''} onClick={() => pickBudgetRow(row)}>
                              <td>{row.관}</td>
                              <td>{row.항}</td>
                              <td>{row.목}</td>
                              <td>{row.세목}</td>
                              <td>{row.내역}</td>
                              <td>{total.toLocaleString()}</td>
                              <td>{balance.toLocaleString()}</td>
                              <td className="budget-rate-cell">{`${rate.toFixed(0)}%`}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <label className="form-field"><span>품의 제목 <i>*</i></span><input name="title" value={form.title} onChange={updateForm} placeholder="예: 현장학습 버스 대절" required maxLength={80} /></label>
              <div className="form-row">
                <label className="form-field"><span>기안 대상 소속 <i>*</i></span><select name="department" value={form.department || user.department || meta.departments[0]} onChange={updateForm}>{meta.departments.map((department) => <option key={department} value={department}>{department}</option>)}</select></label>
                <label className="form-field"><span>비용 항목 <i>*</i></span><select name="category" value={form.category} onChange={updateForm}>{meta.categories.map((category) => <option key={category}>{category}</option>)}</select></label>
              </div>
              <div className="form-row">
                <label className="form-field"><span>요청 금액 <i>*</i></span><div className="currency-input"><span>₩</span><input name="amount" type="number" min="1" step="1" value={form.amount} onChange={updateForm} placeholder="0" required /></div></label>
              </div>
              <label className="form-field"><span>사용 목적 및 메모</span><textarea name="memo" value={form.memo} onChange={updateForm} placeholder="지출이 필요한 이유를 입력해 주세요." rows={3} maxLength={500} /></label>
              <div className="form-field">
                <span>영수증·견적서 이미지 ({images.length}/{meta.maxAttachments})</span>
                <label className="file-picker">
                  <input type="file" accept={IMAGE_TYPES.join(',')} multiple onChange={(event) => void addImages(event)} disabled={images.length >= meta.maxAttachments} />
                  <span>＋ 이미지 선택 (장당 5MB 이하)</span>
                </label>
                {images.length > 0 && (
                  <div className="thumb-grid">
                    {images.map((image) => (
                      <div key={image.key} className="thumb editable">
                        <img src={image.src} alt={image.name} />
                        <button type="button" onClick={() => setImages((current) => current.filter((item) => item.key !== image.key))} aria-label={`${image.name} 삭제`}>×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="approval-form-section">
                <div className="form-section-heading"><span>결재선 (자동 지정)</span><small>기안 대상 소속을 기준으로 결재선이 정해집니다.</small></div>
                {previewError ? <p className="form-error" role="alert">{previewError}</p> : (
                  <ol className="preview-steps">
                    {preview.map((step) => <li key={step.kind}><strong>{step.name}</strong> <span>{step.kind} · {step.position}</span></li>)}
                  </ol>
                )}
              </div>
              {formError && <p className="form-error" role="alert">{formError}</p>}
              <div className="modal-footer"><button className="cancel-button" type="button" onClick={() => setIsFormOpen(false)}>취소</button><button className="primary-button" type="submit" disabled={busy || previewError !== ''}>{editingId === null ? '결재 요청' : '재상신'} <span>→</span></button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}
