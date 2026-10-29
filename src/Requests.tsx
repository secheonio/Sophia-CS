import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { api, ApiError, attachmentUrl } from './api'
import type { ApprovalStep, ExpenseRequest, Meta, NewImage, RequestStatus, User } from './types'

type FilterStatus = '전체' | RequestStatus
const filters: FilterStatus[] = ['전체', '결재 중', '지출 대기', '지출 완료', '반려']
const launchDepartmentRows = [
  ['기초과정', '본과정', '심화과정', '생활관', '전형위원회'],
  ['교무부', '교육과정연구부', '생활교육부', '델포이', '도서관', '행정실'],
]
const launchDepartmentTones: Record<string, 'course' | 'institution' | 'department' | 'accounting'> = {
  기초과정: 'course',
  본과정: 'course',
  심화과정: 'course',
  생활관: 'institution',
  도서관: 'institution',
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

type PaymentRow = {
  id: number
  summary: string
  date: string
  amount: string
  payer: string
  method: string
  attachments: DraftImage[]
}

const MAX_PAYMENT_ROWS = 10

const normalizeMoneyValue = (value: string) => value.replace(/[^\d-]/g, '')
const formatMoneyInputValue = (value: string) => {
  const cleaned = normalizeMoneyValue(value)
  if (!cleaned) return ''
  const numeric = Number(cleaned)
  return Number.isFinite(numeric) ? new Intl.NumberFormat('ko-KR').format(Math.abs(numeric)) : ''
}

const calculateExecutionRate = (total: number, remaining: number) => {
  if (!Number.isFinite(total) || total <= 0) return 0
  return ((total - remaining) / total) * 100
}

const normalizeDateInputForDisplay = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const cleaned = trimmed.replace(/\s+/g, '').replace(/[^\d./\\-]/g, '')
  if (!cleaned) return ''
  const tokens = cleaned.split(/[./\\-]/).filter(Boolean)
  if (tokens.length === 0) return cleaned
  if (tokens.length === 1) return cleaned
  if (tokens.length === 2) return cleaned
  if (tokens.length >= 3) {
    const [monthText, dayText, yearText] = tokens
    const month = Number(monthText)
    const day = Number(dayText)
    const year = Number(yearText)
    const normalizedYear = String(yearText).length === 2 ? 2000 + year : year
    if (!Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(normalizedYear) || month < 1 || month > 12 || day < 1 || day > 31) {
      return cleaned
    }
    return `${normalizedYear}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}.`
  }
  return cleaned
}

const finalizeDateValue = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const cleaned = trimmed.replace(/\s+/g, '').replace(/[^\d./\\-]/g, '')
  if (!cleaned) return ''
  const tokens = cleaned.split(/[./\\-]/).filter(Boolean)
  if (tokens.length === 2) {
    const [monthText, dayText] = tokens
    const month = Number(monthText)
    const day = Number(dayText)
    if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) {
      return cleaned
    }
    const currentYear = new Date().getFullYear()
    return `${currentYear}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}.`
  }
  if (tokens.length >= 3) {
    const [monthText, dayText, yearText] = tokens
    const month = Number(monthText)
    const day = Number(dayText)
    const year = Number(yearText)
    const normalizedYear = String(yearText).length === 2 ? 2000 + year : year
    if (!Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(normalizedYear) || month < 1 || month > 12 || day < 1 || day > 31) {
      return cleaned
    }
    return `${normalizedYear}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}.`
  }
  return cleaned
}

const createPaymentRow = (id: number): PaymentRow => ({
  id,
  summary: '',
  date: '',
  amount: '',
  payer: '',
  method: '',
  attachments: [],
})

function pickDefaultDepartment(user: User, departments: string[]) {
  const validCurrent = user.department && departments.includes(user.department) && user.department !== '교장' && user.department !== '행정실'
  if (validCurrent) return user.department
  return departments.find((department) => department !== '교장' && department !== '행정실') ?? departments[0]
}

interface DraftImage { key: string; name: string; src: string; attachmentId?: number; dataUrl?: string; size?: number; mime?: string }

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

const documentStatusLabel = (status: RequestStatus) => ({
  '결재 중': '결재 진행',
  '지출 대기': '지출 대기',
  '지출 완료': '지출 완료',
  반려: '반려 처리',
} as const)[status] ?? status

function StatusBadge({ status }: { status: RequestStatus }) {
  return <span className={`status-badge status-${slug(status)}`}>{documentStatusLabel(status)}</span>
}

function departmentAuthorityTitle(department?: string) {
  const safeDepartment = (department ?? '').trim()
  if (!safeDepartment) return '상신단위장'
  if (['기초과정', '본과정', '심화과정'].includes(safeDepartment)) {
    return `${safeDepartment}부장`
  }
  return `${safeDepartment}장`
}

function previewRoleLabel(step: { kind: string; position: string }, department?: string) {
  const kindText = step.kind ?? ''
  const positionText = step.position ?? ''
  if (positionText.includes('기관장') || kindText.includes('소속장')) {
    return departmentAuthorityTitle(department)
  }
  if (positionText.includes('행정실장') || kindText.includes('행정실장')) return '행정실장'
  if (positionText.includes('교장') || kindText.includes('교장')) return '교장'
  if (kindText.includes('기안')) return '기안자'
  return positionText || '결재자'
}

function previewActionLabel(step: { kind: string }, department?: string) {
  const kindText = step.kind ?? ''
  if (kindText.includes('소속장')) return `${departmentAuthorityTitle(department)} 결재`
  if (kindText.includes('행정실장 지출처리')) return '지출 처리'
  if (kindText.includes('교장 결재')) return '교장 결재'
  if (kindText.includes('행정실장')) return '행정실장 경유'
  if (kindText.includes('기안')) return '기안 등록'
  return kindText
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
  const [paymentRows, setPaymentRows] = useState<PaymentRow[]>([createPaymentRow(1)])
  const [images, setImages] = useState<DraftImage[]>([])
  const budgetCatalog = meta.budgetCatalog ?? {}
  const formatKoreanAmount = useCallback((amount: number) => {
    const digits = ['영', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
    const units = ['', '만', '억', '조']
    const formatUnderTenThousand = (segment: number) => {
      if (segment <= 0) return ''
      const thousand = Math.floor(segment / 1000)
      const hundred = Math.floor((segment % 1000) / 100)
      const ten = Math.floor((segment % 100) / 10)
      const one = segment % 10
      const chunks: string[] = []
      if (thousand > 0) chunks.push(`${digits[thousand]}천`)
      if (hundred > 0) chunks.push(`${digits[hundred]}백`)
      if (ten === 1) chunks.push('십')
      else if (ten > 1) chunks.push(`${digits[ten]}십`)
      if (one > 0) chunks.push(digits[one])
      return chunks.join(' ')
    }
    if (!Number.isFinite(amount) || amount <= 0) return '영원'
    const groups: number[] = []
    let remaining = Math.trunc(amount)
    while (remaining > 0) {
      groups.push(remaining % 10000)
      remaining = Math.floor(remaining / 10000)
    }
    const reversed = groups.slice().reverse()
    const rendered: string[] = []
    for (let index = 0; index < reversed.length; index += 1) {
      const groupValue = reversed[index]
      const groupText = formatUnderTenThousand(groupValue)
      if (!groupText) continue
      const unitIndex = Math.max(0, reversed.length - index - 1)
      rendered.push(`${groupText}${units[unitIndex] ?? ''}`)
    }
    const combined = rendered.join(' ')
    return `${combined}원정`.replace(/\s+/g, ' ').trim()
  }, [])

  const isMeaningfulPaymentRow = useCallback((row: PaymentRow) => {
    const attachments = Array.isArray(row.attachments) ? row.attachments : []
    const hasSummary = row.summary.trim().length > 0
    const hasDate = row.date.trim().length > 0
    const hasAmount = row.amount.trim().length > 0
    const hasCustomPayer = row.payer.trim().length > 0
    const hasCustomMethod = row.method.trim().length > 0
    return hasSummary || hasDate || hasAmount || attachments.length > 0 || hasCustomPayer || hasCustomMethod
  }, [])
  const budgetRows = form.department ? (budgetCatalog[form.department] ?? []) : []
  const budgetSummary = useMemo(() => {
    const total = budgetRows.reduce((sum, row) => sum + Number(row.예산총액 ?? 0), 0)
    const remaining = budgetRows.reduce((sum, row) => sum + Number(row.예산잔액 ?? 0), 0)
    const spent = Math.max(0, total - remaining)
    const rate = calculateExecutionRate(total, remaining)
    const status = remaining < 0 ? '초과' : rate >= 80 ? '주의' : rate >= 50 ? '보통' : '안정'
    const tone = remaining < 0 ? 'critical' : rate >= 80 ? 'warning' : rate >= 50 ? 'watch' : 'safe'
    const label = remaining < 0 ? '재검토' : rate >= 80 ? '점검' : rate >= 50 ? '모니터링' : '안정'
    const icon = remaining < 0 ? '⚠' : rate >= 80 ? '△' : rate >= 50 ? '◔' : '✓'
    return { total, spent, remaining, rate, status, tone, label, icon }
  }, [budgetRows])
  const totalPaymentAmount = paymentRows.reduce((sum, row) => { const numeric = Number(normalizeMoneyValue(row.amount)); return sum + (Number.isFinite(numeric) ? numeric : 0) }, 0)
  const requestAmount = totalPaymentAmount
  const requestAfterRemaining = budgetSummary.remaining - requestAmount
  const requestAfterRate = calculateExecutionRate(budgetSummary.total, requestAfterRemaining)
  const allAttachedImages = useMemo(() => {
    const merged: Array<{ key: string; name: string; src: string; group: 'global' | 'row'; rowId?: number; rowIndex?: number }> = []
    images.forEach((image) => merged.push({ ...image, group: 'global' }))
    paymentRows.forEach((row) => {
      row.attachments.forEach((image) => {
        merged.push({
          key: `${row.id}-${image.key}`,
          name: image.name,
          src: image.src,
          group: 'row',
          rowId: row.id,
          rowIndex: row.id,
        })
      })
    })
    return merged
  }, [images, paymentRows])

  useEffect(() => {
    setForm((current) => {
      if (String(current.amount) === String(totalPaymentAmount)) return current
      return { ...current, amount: String(totalPaymentAmount) }
    })
  }, [totalPaymentAmount])
  const [formError, setFormError] = useState('')
  const [preview, setPreview] = useState<ApprovalStep[]>([])
  const [previewError, setPreviewError] = useState('')
  const [busy, setBusy] = useState(false)
  const [isRejecting, setIsRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [viewer, setViewer] = useState<{ name: string; src: string } | null>(null)

  const formatBytes = useCallback((bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0B'
    const units = ['B', 'KB', 'MB', 'GB']
    let value = bytes
    let unitIndex = 0
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024
      unitIndex += 1
    }
    const precision = value >= 10 || unitIndex === 0 ? 0 : 1
    return `${value.toFixed(precision)}${units[unitIndex]}`
  }, [])

  const attachmentSummary = useCallback((items: Array<{ name: string; size?: number }>) => {
    const total = items.reduce((sum, item) => sum + (Number(item.size) || 0), 0)
    const count = items.length
    return count > 0 ? `${count}개${total > 0 ? ` · ${formatBytes(total)}` : ''}` : '0개'
  }, [formatBytes])

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
    (request: ExpenseRequest) => request.steps.some((step) => step.userId === user.id && (step.status === '결재 중' || step.status === '대기')),
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
    setPaymentRows(request?.paymentRows?.length
      ? request.paymentRows.map((row, index) => ({
          id: index + 1,
          summary: row.summary ?? '',
          date: row.date ?? '',
          amount: String(row.amount ?? 0),
          payer: row.payer ?? '',
          method: row.method ?? '',
          attachments: (Array.isArray(row.attachments) ? row.attachments : []).map((attachment) => ({
            key: `existing-${row.id ?? index + 1}-${attachment.id ?? crypto.randomUUID()}`,
            name: attachment.name ?? '영수증',
            src: attachment.id ? attachmentUrl(attachment.id) : '',
            attachmentId: attachment.id,
            size: attachment.size,
            mime: attachment.mime,
          })),
        }))
      : [createPaymentRow(1)])
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
    if (name === 'amount') {
      setForm((current) => ({ ...current, amount: normalizeMoneyValue(value) }))
      return
    }
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
    setPaymentRows((current) => {
      const rows = [...current]
      if (rows.length === 0) {
        rows.push(createPaymentRow(1))
      }
      rows[0] = { ...rows[0], summary: '', date: '', payer: '', method: '' }
      return rows
    })
  }

  function updatePaymentRow(id: number, field: keyof PaymentRow, value: string) {
    const normalizedValue = field === 'date' ? normalizeDateInputForDisplay(value) : value
    setPaymentRows((current) => {
      const next = current.map((row) => row.id === id ? { ...row, [field]: normalizedValue } : row)
      const currentRow = next.find((row) => row.id === id)
      const isLastRow = next.length > 0 && next[next.length - 1].id === id
      const hasFilledCurrent = currentRow ? isMeaningfulPaymentRow(currentRow) : false
      if (hasFilledCurrent && isLastRow && next.length < MAX_PAYMENT_ROWS) {
        const targetId = next[next.length - 1].id + 1
        const exists = next.some((row) => row.id === targetId)
        if (!exists) {
          next.push(createPaymentRow(targetId))
        }
      }
      return next
    })
  }

  function movePaymentCellFocus(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    const input = event.currentTarget
    if (input.classList.contains('payment-date-input')) {
      const finalizedDate = finalizeDateValue(input.value)
      if (finalizedDate !== input.value) {
        input.value = finalizedDate
        updatePaymentRow(Number(input.getAttribute('data-row-id') ?? '0'), 'date', finalizedDate)
      }
    }
    event.preventDefault()
    event.stopPropagation()
    const rowElement = input.closest('.budget-payment-row') as HTMLElement | null
    if (!rowElement) return

    const inputs = Array.from(rowElement.querySelectorAll<HTMLInputElement>('input:not([type="file"])'))
    const currentIndex = inputs.indexOf(input)
    const nextInput = inputs[currentIndex + 1]
    if (nextInput) {
      nextInput.focus()
      if (typeof nextInput.select === 'function') {
        nextInput.select()
      }
      return
    }
    input.blur()
  }

  async function addPaymentReceipt(rowId: number, event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const files = Array.from(input.files ?? [])
    input.value = ''
    if (files.length === 0) return
    const invalid = files.find((file) => !IMAGE_TYPES.includes(file.type) || file.size > meta.maxAttachmentBytes)
    if (invalid) {
      setFormError(`${invalid.name}: 5MB 이하의 PNG·JPG·GIF·WEBP 이미지만 첨부할 수 있습니다.`)
      return
    }
    try {
      const added = await Promise.all(files.map(readImage))
      setPaymentRows((current) => current.map((row) => row.id === rowId ? { ...row, attachments: [...row.attachments, ...added] } : row))
      setFormError('')
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : '영수증 이미지를 첨부하지 못했습니다.')
    }
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    const amount = Number(form.amount)
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setFormError('금액은 1원 이상의 정수로 입력해 주세요.')
      return
    }
    const title = form.budgetNae.trim() || '예산 집행 내역'
    const payload = {
      title,
      category: form.category,
      amount,
      memo: '',
      department: form.department || user.department || meta.departments[0],
      budget: {
        관: form.budgetGwan.trim(),
        항: form.budgetHang.trim(),
        목: form.budgetMok.trim(),
        세목: form.budgetSemok.trim(),
        내역: form.budgetNae.trim(),
      },
      paymentRows: paymentRows
        .filter((row) => row.summary.trim() || row.date.trim() || row.amount.trim() || row.payer.trim() || row.method.trim() || row.attachments.length > 0)
        .map((row) => ({
          summary: row.summary.trim(),
          date: row.date.trim(),
          amount: Number(String(row.amount).replace(/[^0-9-]/g, '')) || 0,
          payer: row.payer.trim(),
          method: row.method.trim(),
          attachments: row.attachments.map((attachment) => ({
            id: attachment.attachmentId,
            name: attachment.name,
            size: attachment.size ?? 0,
            mime: attachment.mime ?? 'image/png',
            dataUrl: attachment.dataUrl,
          })),
        })),
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
        <div className="department-launch-stack" aria-label="상신 단위 선택">
          {launchDepartmentRows.map((row, rowIndex) => (
            <div key={`launch-row-${rowIndex}`} className="department-launch-grid" role="group" aria-label={`상신 단위 ${rowIndex + 1}줄`}>
              {row.map((department) => (
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
                {selected.paymentRows?.length > 0 && (
                  <div className="memo-info payment-detail-block">
                    <span>지급 내역</span>
                    <div className="payment-detail-list">
                      {selected.paymentRows.map((row, index) => (
                        <div key={row.id ?? `${row.summary}-${index}`} className="payment-detail-row">
                          <div className="payment-detail-header">
                            <strong>#{row.seq ?? index + 1}</strong>
                            <span>{row.summary || '적요 미입력'}</span>
                            <small>{row.date || '날짜 미입력'} · {Number(row.amount ?? 0).toLocaleString()}원 · {row.payer || '미기재'} · {row.method || '미기재'}</small>
                          </div>
                          <div className="payment-detail-attachments">
                            <small>영수증 {attachmentSummary(row.attachments ?? [])}</small>
                            {row.attachments && row.attachments.length > 0 ? (
                              <div className="thumb-grid">
                                {row.attachments.map((attachment) => (
                                  <button key={attachment.id ?? `${row.id ?? index}-receipt-${attachment.name}`} type="button" className="thumb" onClick={() => attachment.id ? setViewer({ name: attachment.name, src: attachmentUrl(attachment.id) }) : undefined} aria-label={`${attachment.name} 크게 보기`}>
                                    <img src={attachment.id ? attachmentUrl(attachment.id) : ''} alt={attachment.name} />
                                  </button>
                                ))}
                              </div>
                            ) : <strong>첨부된 영수증이 없습니다.</strong>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
            <form onSubmit={(event) => void submit(event)} onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              const target = event.target as HTMLElement
              const paymentRow = target.closest('.budget-payment-row')
              if (paymentRow && target instanceof HTMLInputElement && target.type !== 'file') {
                event.preventDefault()
                const inputs = Array.from(paymentRow.querySelectorAll<HTMLInputElement>('input:not([type="file"])'))
                const currentIndex = inputs.indexOf(target)
                const nextInput = inputs[currentIndex + 1]
                if (nextInput) {
                  nextInput.focus()
                  if (typeof nextInput.select === 'function') nextInput.select()
                } else {
                  target.blur()
                }
                return
              }
              event.preventDefault()
              event.stopPropagation()
            }}>
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
              <div className="request-budget-summary">
                <div className="request-budget-card total">
                  <span>
                    총예산
                    <em className="budget-tag budget-tag-base">기준</em>
                  </span>
                  <strong>{budgetSummary.total.toLocaleString()}원</strong>
                </div>
                <div className="request-budget-card spent">
                  <span>
                    지출액
                    <em className={`budget-tag budget-tag-${budgetSummary.tone}`}>{budgetSummary.label}</em>
                  </span>
                  <strong>{budgetSummary.spent.toLocaleString()}원</strong>
                </div>
                <div className="request-budget-card remaining">
                  <span>
                    잔액
                    <em className={`budget-tag budget-tag-${budgetSummary.tone}`}>{budgetSummary.remaining < 0 ? '재검토' : budgetSummary.remaining > 0 ? '여유' : '소진'}</em>
                  </span>
                  <strong>{budgetSummary.remaining.toLocaleString()}원</strong>
                </div>
                <div className="request-budget-card rate">
                  <span>
                    집행률
                    <em className={`budget-tag budget-tag-${budgetSummary.tone}`}>{budgetSummary.rate >= 80 ? '주의' : budgetSummary.rate >= 50 ? '보통' : '안정'}</em>
                  </span>
                  <strong>{budgetSummary.rate.toFixed(1)}%</strong>
                </div>
              </div>
              <div className="request-budget-summary request-budget-summary-followup">
                <div className="request-budget-card request-budget-card-empty">
                  <span> </span>
                  <strong> </strong>
                </div>
                <div className="request-budget-card requested">
                  <span>
                    요청액
                    <em className={`budget-tag budget-tag-${budgetSummary.tone}`}>예정</em>
                  </span>
                  <strong>{formatCurrency(requestAmount)}원</strong>
                </div>
                <div className="request-budget-card request-after-remaining">
                  <span>
                    요청후 잔액
                    <em className={`budget-tag budget-tag-${budgetSummary.tone}`}>{requestAfterRemaining < 0 ? '재검토' : requestAfterRemaining > 0 ? '여유' : '소진'}</em>
                  </span>
                  <strong>{formatCurrency(requestAfterRemaining)}원</strong>
                </div>
                <div className="request-budget-card request-after-rate">
                  <span>
                    요청후 집행률
                    <em className={`budget-tag budget-tag-${budgetSummary.tone}`}>{requestAfterRate >= 80 ? '주의' : requestAfterRate >= 50 ? '보통' : '안정'}</em>
                  </span>
                  <strong>{requestAfterRate.toFixed(1)}%</strong>
                </div>
              </div>
              <div className="budget-detail-form-card">
                <div className="budget-detail-table">
                  <div className="budget-detail-header">
                    <span>관</span>
                    <span>항</span>
                    <span>목</span>
                    <span>세목</span>
                  </div>
                  <div className="budget-detail-row">
                    <span>{form.budgetGwan || '—'}</span>
                    <span>{form.budgetHang || '—'}</span>
                    <span>{form.budgetMok || '—'}</span>
                    <span>{form.budgetSemok || '—'}</span>
                  </div>
                  <div className="budget-detail-header single"><span>내역</span></div>
                  <div className="budget-detail-row single">
                    <input name="budgetNae" value={form.budgetNae} onChange={updateForm} placeholder="예산 내역을 직접 입력하거나 수정하세요." aria-label="예산 내역" />
                  </div>
                </div>

                <div className="receipt-upload-zone">
                  <div className="budget-payment-table">
                    <div className="budget-payment-header">
                      <span>번호</span>
                      <span>적요</span>
                      <span>일자</span>
                      <span>금액</span>
                      <span>성명(상호)</span>
                      <span>지급방법</span>
                      <span>영수증</span>
                    </div>
                    {paymentRows.map((row) => {
                      const rowAttachments = Array.isArray(row.attachments) ? row.attachments : []
                      return (
                        <div key={row.id} className="budget-payment-row">
                          <span className="payment-row-index">{row.id}</span>
                          <input className="payment-summary-input" value={row.summary} onChange={(event) => updatePaymentRow(row.id, 'summary', event.currentTarget.value)} onKeyDown={movePaymentCellFocus} placeholder="적요 입력" aria-label={`적요 ${row.id}`} />
                          <input className="payment-date-input" data-row-id={String(row.id)} value={row.date} onChange={(event) => updatePaymentRow(row.id, 'date', event.currentTarget.value)} onBlur={(event) => {
                            const nextValue = finalizeDateValue(event.currentTarget.value)
                            if (nextValue !== event.currentTarget.value) {
                              updatePaymentRow(row.id, 'date', nextValue)
                            }
                          }} onKeyDown={movePaymentCellFocus} placeholder="M/D" title="예: 10/23 → 2026.10.23." aria-label={`일자 ${row.id}`} />
                          <input className="payment-amount-input" value={formatMoneyInputValue(row.amount)} onChange={(event) => updatePaymentRow(row.id, 'amount', normalizeMoneyValue(event.currentTarget.value))} onKeyDown={movePaymentCellFocus} placeholder="0" aria-label={`금액 ${row.id}`} />
                          <input className="payment-payer-input" value={row.payer} onChange={(event) => updatePaymentRow(row.id, 'payer', event.currentTarget.value)} onKeyDown={movePaymentCellFocus} placeholder="" aria-label={`성명(상호) ${row.id}`} />
                          <input className="payment-method-input" value={row.method} onChange={(event) => updatePaymentRow(row.id, 'method', event.currentTarget.value)} onKeyDown={movePaymentCellFocus} placeholder="" aria-label={`지급방법 ${row.id}`} />
                          <div className="receipt-cell">
                            <label className="receipt-upload-button">
                              <input type="file" accept={IMAGE_TYPES.join(',')} onChange={(event) => void addPaymentReceipt(row.id, event)} />
                              <span>{rowAttachments.length > 0 ? `영수증 ${attachmentSummary(rowAttachments)}` : '영수증 첨부'}</span>
                            </label>
                          </div>
                        </div>
                      )
                    })}
                    <div className="budget-payment-total">
                      <span className="budget-payment-total-title">합계</span>
                      <span className="budget-payment-total-amount">{totalPaymentAmount.toLocaleString()}원</span>
                      <span className="budget-payment-total-korean">({formatKoreanAmount(totalPaymentAmount)})</span>
                    </div>
                    <div className="payment-date-helper">날짜는 M/D 입력 시 자동으로 YYYY.MM.DD. 형식으로 기록됩니다.</div>
                  </div>

                  <div className="form-field image-upload-field">
                    <div className="image-upload-inline">
                      <span>영수증·견적서 이미지</span>
                    </div>
                    {allAttachedImages.length > 0 && (
                      <div className="thumb-grid">
                        {allAttachedImages.map((image) => (
                          <div key={image.key} className="thumb editable">
                            <img src={image.src} alt={image.name} />
                            <button type="button" onClick={() => {
                              if (image.group === 'global') {
                                setImages((current) => current.filter((item) => item.key !== image.key))
                                return
                              }
                              setPaymentRows((current) => current.map((row) => row.id === image.rowId ? { ...row, attachments: (Array.isArray(row.attachments) ? row.attachments : []).filter((item) => `${row.id}-${item.key}` !== image.key) } : row))
                            }} aria-label={`${image.name} 삭제`}>×</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="approval-form-section">
                <div className="form-section-heading"><span>지출 품의 처리 순</span><small>기안 대상 소속을 기준으로 처리 흐름이 정해집니다.</small></div>
                {previewError ? <p className="form-error" role="alert">{previewError}</p> : (
                  <div className="preview-flow" aria-label="결재선 흐름">
                    <div className="preview-flow-node preview-flow-start">
                      <span className="preview-flow-label">기안자</span>
                      <strong>{user.name}</strong>
                    </div>
                    {preview.map((step, index) => (
                      <div key={`${step.kind}-${step.name}-${index}`} className="preview-flow-item">
                        <span className="preview-flow-arrow" aria-hidden="true">→</span>
                        <div className={`preview-flow-node ${index === 0 ? 'preview-flow-current' : 'preview-flow-past'}`}>
                          <span className="preview-flow-label">{previewRoleLabel(step, form.department)}</span>
                          <strong>{step.name}</strong>
                          <small>{previewActionLabel(step, form.department)}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {formError && <p className="form-error" role="alert">{formError}</p>}
              <div className="modal-footer"><button className="cancel-button" type="button" onClick={() => setIsFormOpen(false)}>취소</button><button className="primary-button" type="button" onClick={() => void submit()} disabled={busy || previewError !== ''}>{editingId === null ? '결재 요청' : '재상신'} <span>→</span></button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}
