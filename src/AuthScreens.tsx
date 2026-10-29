import { useState, type FormEvent } from 'react'
import { api, ApiError } from './api'
import type { User } from './types'

const normalizePhoneInput = (value: string) => value.replace(/\D/g, '').slice(0, 11)

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
  const [showPasswordChange, setShowPasswordChange] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const wantsPasswordChange = !forced && showPasswordChange && (next.trim().length > 0 || confirm.trim().length > 0)
  const helperText = forced
    ? '처음 로그인하신 경우, 새 비밀번호를 설정해 주세요. 이메일과 전화번호는 선택 입력이며 나중에도 수정할 수 있습니다.'
    : '먼저 이메일과 전화번호를 수정하고, 비밀번호를 바꾸려면 아래에서 선택해 주세요. 현재 비밀번호를 계속 사용할 수도 있습니다.'

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!current.trim()) {
      setError('현재 비밀번호를 입력해 주세요.')
      return
    }
    if (email.trim() && !email.trim().includes('@')) {
      setError('이메일에는 @가 포함되어야 합니다.')
      return
    }
    if (phone.trim() && !/^\d{10,11}$/.test(phone.trim())) {
      setError('전화번호는 하이픈 없이 10~11자리 숫자만 입력해 주세요. (예: 01012345678)')
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
      const contact = {
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      }
      onDone((await api.changePassword(current, next.trim(), Object.keys(contact).length ? contact : undefined)).user)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '정보를 변경하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const form = (
    <form className="auth-card" onSubmit={submit}>
      <h1>{forced ? '비밀번호 변경' : '내 정보 수정'}</h1>
      <p>{forced ? `${user.name}님, 안전한 사용을 위해 새 비밀번호를 설정해 주세요.` : `${user.name}님의 이메일, 전화번호, 비밀번호를 수정할 수 있습니다.`}</p>
      <p className="auth-help" style={{ marginTop: 0 }}>{helperText}</p>
      <label className="form-field"><span>{forced ? '임시 비밀번호' : '현재 비밀번호'}</span>
        <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.currentTarget.value)} required autoFocus />
      </label>
      <label className="form-field"><span>이메일 (선택)</span>
        <input type="text" inputMode="email" pattern=".*@.*" title="이메일에는 @가 포함되어야 합니다." value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
      </label>
      <label className="form-field"><span>전화번호 (선택)</span>
        <input type="tel" inputMode="numeric" pattern="^\d{10,11}$" title="01012345678" value={phone} onChange={(e) => setPhone(normalizePhoneInput(e.currentTarget.value))} />
      </label>
      {!forced && (
        <label className="form-field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={showPasswordChange}
            onChange={(e) => {
              const nextChecked = e.currentTarget.checked
              setShowPasswordChange(nextChecked)
              if (!nextChecked) {
                setNext('')
                setConfirm('')
              }
            }}
          />
          <span>비밀번호를 변경할게요</span>
        </label>
      )}
      {(forced || showPasswordChange) && (
        <>
          <label className="form-field"><span>{forced ? '새 비밀번호 (8자 이상)' : '새 비밀번호 (8자 이상)'}</span>
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.currentTarget.value)} minLength={8} />
          </label>
          <label className="form-field"><span>{forced ? '새 비밀번호 확인' : '새 비밀번호 확인'}</span>
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.currentTarget.value)} />
          </label>
        </>
      )}
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
