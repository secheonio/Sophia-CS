import { useState, type FormEvent } from 'react'
import { api, ApiError } from './api'
import type { User } from './types'

export function LoginScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      onLogin((await api.login(name, password)).user)
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
        <label className="form-field"><span>이름</span>
          <input type="text" autoComplete="username" value={name} onChange={(e) => setName(e.currentTarget.value)} required autoFocus />
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

export function PasswordChange({ user, forced, onDone, onCancel, onLogout }: {
  user: User
  forced: boolean
  onDone: (user: User) => void
  onCancel?: () => void
  onLogout?: () => void
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [email, setEmail] = useState(user.email ?? '')
  const [phone, setPhone] = useState(user.phone ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const requireContact = forced || !user.email || !user.phone
  const wantsPasswordChange = next.trim().length > 0 || confirm.trim().length > 0

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!current.trim()) {
      setError('현재 비밀번호를 입력해 주세요.')
      return
    }
    if (requireContact && !email.trim()) {
      setError('이메일을 입력해 주세요.')
      return
    }
    if (requireContact && !phone.trim()) {
      setError('전화번호를 입력해 주세요.')
      return
    }
    if (email.trim() && !/^[^@\s]+@[^@\s]+$/.test(email.trim())) {
      setError('이메일 형식이 올바르지 않습니다. 예: anstnrdud@naver.com')
      return
    }
    if (phone.trim() && !/^\d{3}-\d{4}-\d{4}$/.test(phone.trim())) {
      setError('전화번호 형식이 올바르지 않습니다. 예: 010-1234-5678')
      return
    }
    if (wantsPasswordChange && next.trim().length < 8) {
      setError('새 비밀번호는 8자 이상이어야 합니다.')
      return
    }
    if (wantsPasswordChange && next !== confirm) {
      setError('새 비밀번호 확인이 일치하지 않습니다.')
      return
    }
    if (wantsPasswordChange && next.trim() === current.trim()) {
      setError('새 비밀번호는 현재 비밀번호와 달라야 합니다.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const contact = { email: email.trim(), phone: phone.trim() }
      onDone((await api.changePassword(current, next.trim(), contact)).user)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '정보를 변경하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const form = (
    <form className="auth-card" onSubmit={submit}>
      <h1>{forced ? '비밀번호 변경' : '내 정보 수정'}</h1>
      <p>{forced ? `${user.name}님, 처음 사용하기 전에 새 비밀번호를 설정해 주세요.` : `${user.name}님의 이메일, 전화번호, 비밀번호를 수정할 수 있습니다.`}</p>
      <label className="form-field"><span>{forced ? '임시 비밀번호' : '현재 비밀번호'}</span>
        <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.currentTarget.value)} required autoFocus />
      </label>
      <label className="form-field"><span>이메일</span>
        <input type="text" inputMode="email" pattern="^[^@\\s]+@[^@\\s]+$" title="anstnrdud@naver.com" value={email} onChange={(e) => setEmail(e.currentTarget.value)} required={requireContact} />
      </label>
      <label className="form-field"><span>전화번호</span>
        <input type="tel" pattern="^\\d{3}-\\d{4}-\\d{4}$" title="010-1234-5678" value={phone} onChange={(e) => setPhone(e.currentTarget.value)} required={requireContact} />
      </label>
      <label className="form-field"><span>{forced ? '새 비밀번호 (8자 이상)' : '새 비밀번호 (선택사항, 8자 이상)'}</span>
        <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.currentTarget.value)} minLength={8} />
      </label>
      <label className="form-field"><span>{forced ? '새 비밀번호 확인' : '새 비밀번호 확인 (선택사항)'}</span>
        <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.currentTarget.value)} />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-footer">
        {onCancel && <button className="cancel-button" type="button" onClick={onCancel}>취소</button>}
        {forced && onLogout && (
          <button className="cancel-button" type="button" onClick={onLogout}>다른 계정으로 로그인</button>
        )}
        <button className="primary-button" type="submit" disabled={busy}>{forced ? '변경' : '저장'}</button>
      </div>
    </form>
  )
  return forced ? <div className="auth-page">{form}</div> : <div className="modal-backdrop">{form}</div>
}
