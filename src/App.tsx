import { useCallback, useEffect, useState } from 'react'
import { api, setUnauthorizedHandler } from './api'
import { LoginScreen, PasswordChange } from './AuthScreens'
import { Requests } from './Requests'
import { UserAdmin } from './UserAdmin'
import type { Meta, User } from './types'
import './App.css'

type View = 'requests' | 'inbox' | 'users'

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [booting, setBooting] = useState(true)
  const [view, setView] = useState<View>('requests')
  const [waiting, setWaiting] = useState(0)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [changingPassword, setChangingPassword] = useState(false)

  const notify = useCallback((text: string) => setNotice({ text, error: false }), [])
  const onError = useCallback((text: string) => setNotice({ text, error: true }), [])

  useEffect(() => {
    setUnauthorizedHandler(() => { setUser(null); setMeta(null) })
    api.me().then((result) => setUser(result.user)).catch(() => {}).finally(() => setBooting(false))
  }, [])

  const ready = Boolean(user && !user.mustChangePassword)
  useEffect(() => {
    if (!ready) return
    api.meta().then(setMeta).catch(() => onError('기본 정보를 불러오지 못했습니다.'))
  }, [ready, onError])

  async function logout() {
    await api.logout().catch(() => {})
    setUser(null)
    setMeta(null)
    setView('requests')
    setNotice(null)
  }

  if (booting) return <div className="auth-page"><p>불러오는 중…</p></div>
  if (!user) return <LoginScreen onLogin={setUser} />
  if (user.mustChangePassword) return <PasswordChange user={user} forced onDone={setUser} />

  const isAdmin = user.position === '교장'
  const nav = (target: View, icon: string, label: string, count?: number) => (
    <button className={`nav-item ${view === target ? 'active' : ''}`} type="button" onClick={() => setView(target)}>
      <span>{icon}</span> {label}{count ? <span className="nav-count">{count}</span> : null}
    </button>
  )

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="workspace-switch"><span className="workspace-icon">S</span><span className="workspace-name">소피아</span></div>
        <div className="nav-label">지출품의</div>
        <nav className="main-nav" aria-label="주 메뉴">
          {nav('requests', '▤', '지출품의')}
          {nav('inbox', '◷', '내 결재함', waiting)}
        </nav>
        <div className="sidebar-spacer" />
        {isAdmin && (
          <>
            <div className="nav-label">관리</div>
            <nav className="main-nav" aria-label="관리 메뉴">{nav('users', '⚙', '사용자·직책')}</nav>
          </>
        )}
        <div className="sidebar-user">
          <span className="avatar avatar-purple">{user.name.slice(0, 1)}</span>
          <span className="sidebar-user-copy"><strong>{user.name}</strong><small>{user.department} {user.position}</small></span>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>행정</span><span className="crumb-separator">/</span><strong>{view === 'users' ? '사용자·직책' : '지출품의'}</strong></div>
          <div className="topbar-actions">
            <button className="cancel-button" type="button" onClick={() => setChangingPassword(true)}>비밀번호 변경</button>
            <button className="cancel-button" type="button" onClick={() => void logout()}>로그아웃</button>
          </div>
        </header>

        {meta && view === 'users' && isAdmin && <UserAdmin me={user} meta={meta} onError={onError} />}
        {meta && view !== 'users' && (
          <Requests key={view} user={user} meta={meta} inboxOnly={view === 'inbox'} onWaitingCount={setWaiting} notify={notify} onError={onError} />
        )}
      </main>

      {notice && (
        <div className={`toast ${notice.error ? 'toast-error' : ''}`} role={notice.error ? 'alert' : 'status'}>
          <span>{notice.error ? '!' : '✓'}</span>{notice.text}
          <button type="button" aria-label="알림 닫기" onClick={() => setNotice(null)}>×</button>
        </div>
      )}

      {changingPassword && (
        <PasswordChange user={user} forced={false} onCancel={() => setChangingPassword(false)}
          onDone={(next) => { setUser(next); setChangingPassword(false); notify('비밀번호를 변경했습니다.') }} />
      )}
    </div>
  )
}

export default App
