export type Position = '교장' | '행정실장' | '기관장' | '기안자'
export type StepKind = '확인 결재' | '최종 결재' | '지출 처리'
export type StepStatus = '대기' | '결재 중' | '승인' | '반려'
export type RequestStatus = '결재 중' | '지출 대기' | '지출 완료' | '반려'

export interface User {
  id: number
  email: string
  name: string
  department: string
  position: Position
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
  rejection: { by: string; reason: string; date: string } | null
}

export interface Meta {
  departments: string[]
  categories: string[]
  positions: Position[]
  departmentsByPosition: Record<string, string[]>
  maxAttachments: number
  maxAttachmentBytes: number
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
  newAttachments: NewImage[]
  keepAttachmentIds?: number[]
}
