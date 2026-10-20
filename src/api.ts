import type { ApprovalStep, ExpenseRequest, Meta, RequestPayload, User } from './types'

export class ApiError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

let onUnauthorized: () => void = () => {}
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    })
  } catch {
    throw new ApiError(0, '서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.')
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401 && url !== '/api/auth/login') onUnauthorized()
    throw new ApiError(response.status, data.error ?? '요청을 처리하지 못했습니다.', data.code)
  }
  return data as T
}

export const api = {
  me: () => call<{ user: User }>('GET', '/api/me'),
  login: (email: string, password: string) => call<{ user: User }>('POST', '/api/auth/login', { email, password }),
  logout: () => call<{ ok: true }>('POST', '/api/auth/logout'),
  changePassword: (currentPassword: string, newPassword: string) =>
    call<{ user: User }>('POST', '/api/auth/change-password', { currentPassword, newPassword }),
  meta: () => call<Meta>('GET', '/api/meta'),
  requests: () => call<{ requests: ExpenseRequest[] }>('GET', '/api/requests'),
  preview: () => call<{ steps: ApprovalStep[] }>('GET', '/api/approval-preview'),
  create: (payload: RequestPayload) => call<{ request: ExpenseRequest }>('POST', '/api/requests', payload),
  resubmit: (id: number, payload: RequestPayload) =>
    call<{ request: ExpenseRequest }>('POST', `/api/requests/${id}/resubmit`, payload),
  decide: (id: number, action: 'approve' | 'reject', reason?: string) =>
    call<{ request: ExpenseRequest }>('POST', `/api/requests/${id}/decision`, { action, reason }),
  users: () => call<{ users: User[] }>('GET', '/api/users'),
  addUser: (input: { name: string; email: string; department: string; position: string }) =>
    call<{ user: User; temporaryPassword: string }>('POST', '/api/users', input),
  updateUser: (id: number, input: Partial<Pick<User, 'name' | 'department' | 'position' | 'active'>>) =>
    call<{ user: User }>('PATCH', `/api/users/${id}`, input),
  resetPassword: (id: number) => call<{ temporaryPassword: string }>('POST', `/api/users/${id}/reset-password`),
  transferPrincipal: (input: { userId?: number; name?: string; email?: string; confirm: true }) =>
    call<{ user: User; temporaryPassword: string | null; transferredSteps: number }>('POST', '/api/principal/transfer', input),
}

export const attachmentUrl = (id: number) => `/api/attachments/${id}`
