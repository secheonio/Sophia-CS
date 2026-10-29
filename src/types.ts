export type Position = '없음' | '기안자' | '기관장' | '교장' | '행정실장'
export type StepKind = '소속장 결재' | '교장 결재 대기중' | '교장 결재' | '행정실장 지출처리' | '교장 결재, 지출처리 요청' | '행정실장 경유'
export type StepStatus = '대기' | '결재 중' | '승인' | '반려'
export type RequestStatus = '결재 중' | '지출 대기' | '지출 완료' | '반려'

export interface User {
  id: number
  email: string
  phone: string
  name: string
  department: string
  position: Position
  departments: string[]
  positions: Position[]
  active: boolean
  mustChangePassword: boolean
}

export interface ApprovalStep {
  userId?: number
  name: string
  position: Position
  kind: StepKind
  status?: StepStatus
  date?: string | null
}

export interface Attachment {
  id: number
  name: string
}

export interface PaymentAttachment {
  id?: number
  name: string
  size?: number
  mime?: string
  dataUrl?: string
}

export interface PaymentRowEntry {
  id?: number
  seq?: number
  summary: string
  date: string
  amount: number
  payer: string
  method: string
  attachments?: PaymentAttachment[]
}

export interface ExpenseRequest {
  id: number
  code: string
  title: string
  category: string
  amount: number
  memo: string
  requesterId: number
  requester: string
  department: string
  date: string
  status: RequestStatus
  steps: Required<ApprovalStep>[]
  attachments: Attachment[]
  paymentRows: PaymentRowEntry[]
  rejection: { by: string; reason: string; date: string } | null
}

export interface BudgetTableRow {
  관: string
  항: string
  목: string
  세목: string
  내역: string
  예산총액: number
  예산잔액: number
  집행률: number
  isSubtotal?: boolean
}

export interface Meta {
  departments: string[]
  categories: string[]
  positions: Position[]
  departmentsByPosition: Record<string, string[]>
  maxAttachments: number
  maxAttachmentBytes: number
  budgetDepartments: string[]
  budgetCatalog: Record<string, BudgetTableRow[]>
}

export interface NewImage {
  name: string
  dataUrl: string
}

export interface RequestPayload {
  title: string
  category: string
  amount: number
  memo: string
  department?: string
  budget?: {
    관: string
    항: string
    목: string
    세목: string
    내역: string
  }
  paymentRows?: Array<{
    summary: string
    date: string
    amount: number
    payer: string
    method: string
    attachments?: PaymentAttachment[]
  }>
  newAttachments: NewImage[]
  keepAttachmentIds?: number[]
}
