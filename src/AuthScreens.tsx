import { useState, type FormEvent } from 'react'
import { api, ApiError } from './api'
import type { User } from './types'

export function LoginScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      onLogin((await api.login(email, password)).user)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '로그인하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <span className="brand-mark">S</span>
        <h1>소피아 지출품의</h1>
        <p>학교에서 발급받은 계정으로 로그인하세요.</p>
        <label className="form-field"><span>이메일</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.currentTarget.value)} required autoFocus />
        </label>
        <label className="form-field"><span>비밀번호</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} required />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={busy}>{busy ? '확인 중…' : '로그인'}</button>
        <small className="auth-help">계정이 없거나 비밀번호를 잊었다면 교장 선생님(관리자)께 문의하세요.</small>
      </form>
    </div>
  )
}

export function PasswordChange({ user, forced, onDone, onCancel }: {
  user: User
  forced: boolean
  onDone: (user: User) => void
  onCancel?: () => void
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (next !== confirm) {
      setError('새 비밀번호 확인이 일치하지 않습니다.')
      return
    }
    setBusy(true)
    setError('')
    try {
      onDone((await api.changePassword(current, next)).user)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '비밀번호를 변경하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const form = (
    <form className="auth-card" onSubmit={submit}>
      <h1>비밀번호 변경</h1>
      <p>{forced ? `${user.name}님, 처음 사용하기 전에 새 비밀번호를 설정해 주세요.` : '새 비밀번호를 입력해 주세요.'}</p>
      <label className="form-field"><span>{forced ? '임시 비밀번호' : '현재 비밀번호'}</span>
        <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.currentTarget.value)} required autoFocus />
      </label>
      <label className="form-field"><span>새 비밀번호 (8자 이상)</span>
        <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.currentTarget.value)} required minLength={8} />
      </label>
      <label className="form-field"><span>새 비밀번호 확인</span>
        <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.currentTarget.value)} required />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-footer">
        {onCancel && <button className="cancel-button" type="button" onClick={onCancel}>취소</button>}
        <button className="primary-button" type="submit" disabled={busy}>변경</button>
      </div>
    </form>
  )
  return forced ? <div className="auth-page">{form}</div> : <div className="modal-backdrop">{form}</div>
}
