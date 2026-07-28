import { ArrowLeft, Check, ChevronRight, CloudOff, ExternalLink, LogOut, Pencil, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { FormEvent, useEffect, useRef, useState } from 'react'
import { CloudApiError, cloudAuth, cloudAuthChallenge, echoraCloudUrl } from '../cloudApi'
import type { CloudAuthChallenge as AuthChallenge, CloudUser } from '../cloudApi'
import { flushCloudOutbox, hasPendingCloudChanges } from '../cloudSync'
import { openExternalUrl } from '../externalNavigation'
import type { RuntimeCapabilities } from '../runtimeCapabilities'
import type { UserProfile } from '../userProfile'
import { useCloudSession } from '../useCloudSession'
import BrandMark from './BrandMark'
import CloudAuthChallenge from './CloudAuthChallenge'

type AccountMode = 'login' | 'register' | 'recover' | 'pending-deletion'
type AuthRequest = {
  mode: Exclude<AccountMode, 'pending-deletion'>
  username: string
  password: string
  displayName: string
  recoveryCode: string
}
type PendingAuthChallenge = { challenge: AuthChallenge; request: AuthRequest }
type Props = {
  mobile?: boolean
  presentation?: 'page' | 'dialog'
  profile: UserProfile
  runtime: RuntimeCapabilities
  onProfileChange: (profile: UserProfile) => Promise<void> | void
  onClose: () => void
}

export default function AccountSpace({ mobile = false, presentation = 'page', profile, runtime, onProfileChange, onClose }: Props) {
  const rootRef = useRef<HTMLElement>(null)
  const { session, online, syncPhase } = useCloudSession()
  const [mode, setMode] = useState<AccountMode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState(profile.id.startsWith('local-') ? '' : profile.displayName)
  const [recoveryCode, setRecoveryCode] = useState('')
  const [issuedRecoveryCode, setIssuedRecoveryCode] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingChallenge, setPendingChallenge] = useState<PendingAuthChallenge | null>(null)
  const [profileEditing, setProfileEditing] = useState(false)
  const [profileDraft, setProfileDraft] = useState(profile.displayName)
  useEffect(() => {
    rootRef.current?.scrollTo?.({ top: 0, behavior: 'auto' })
  }, [issuedRecoveryCode, mode, session?.user.id])

  useEffect(() => {
    if (!session) return
    setProfileDraft(session.user.displayName)
    setProfileEditing(false)
  }, [session?.user.displayName, session?.user.id])

  useEffect(() => {
    if (presentation !== 'dialog') return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose, presentation])

  const changeMode = (nextMode: AccountMode) => {
    setMode(nextMode)
    setPassword('')
    setRecoveryCode('')
    setStatus('')
    setPendingChallenge(null)
  }

  const runAuthRequest = async (request: AuthRequest, turnstileToken?: string) => {
    setBusy(true)
    setStatus(turnstileToken ? '正在完成安全验证' : '')
    try {
      if (request.mode === 'register') {
        const result = await cloudAuth.register({ username: request.username, password: request.password, displayName: request.displayName || request.username }, turnstileToken)
        await onProfileChange({ id: result.user.id, displayName: result.user.displayName, createdAt: result.user.createdAt })
        setIssuedRecoveryCode(result.recoveryCode)
      } else if (request.mode === 'recover') {
        const result = await cloudAuth.recover(request.username, request.recoveryCode, request.password, turnstileToken)
        setIssuedRecoveryCode(result.recoveryCode)
      } else {
        const result = await cloudAuth.login(request.username, request.password, turnstileToken)
        await onProfileChange({ id: result.user.id, displayName: result.user.displayName, createdAt: result.user.createdAt })
      }
      setPendingChallenge(null)
      setStatus('')
      setPassword('')
    } catch (error) {
      const challenge = cloudAuthChallenge(error)
      if (challenge) {
        setPendingChallenge({ challenge, request })
        setStatus('请完成安全验证')
      } else if (request.mode === 'login' && error instanceof CloudApiError && error.status === 423) {
        setMode('pending-deletion')
        setPendingChallenge(null)
        setStatus('')
      } else {
        setPendingChallenge(null)
        setStatus(error instanceof Error ? error.message : '账户操作未完成')
      }
    } finally {
      setBusy(false)
    }
  }

  const submitAuth = (event: FormEvent) => {
    event.preventDefault()
    if (!online || !username.trim() || password.length < 8 || pendingChallenge) return
    void runAuthRequest({ mode: mode as AuthRequest['mode'], username: username.trim(), password, displayName: displayName.trim(), recoveryCode: recoveryCode.trim() })
  }

  const openCloudAccount = async () => {
    try {
      await openExternalUrl(`${echoraCloudUrl}/account`, runtime)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '无法打开账户网页')
    }
  }

  const logout = async () => {
    if (session && hasPendingCloudChanges(session.user.id) && !online) {
      setStatus('仍有未提交的账户更改，请联网后再退出')
      return
    }
    setBusy(true)
    setStatus('')
    try {
      if (session && hasPendingCloudChanges(session.user.id)) await flushCloudOutbox(session)
      await cloudAuth.logout()
      setMode('login')
      setUsername('')
      setStatus('')
    } catch (error) {
      setStatus(error instanceof CloudApiError && error.code === 'sync_entity_too_large'
        ? '有一项账户内容暂时无法保存，请整理较长的会话或歌单后再退出'
        : error instanceof Error ? error.message : '退出登录未完成')
    } finally {
      setBusy(false)
    }
  }

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault()
    const nextName = profileDraft.trim()
    if (!session || !online || !nextName || nextName === session.user.displayName) {
      setProfileEditing(false)
      return
    }
    setBusy(true)
    setStatus('')
    try {
      const user = await cloudAuth.updateProfile(nextName)
      await onProfileChange({ id: user.id, displayName: user.displayName, createdAt: user.createdAt })
      setProfileDraft(user.displayName)
      setProfileEditing(false)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '显示名称未更新')
    } finally {
      setBusy(false)
    }
  }

  const renderAuth = () => {
    if (issuedRecoveryCode) return <section className="account-recovery-result">
      <span className="account-result-icon"><Check size={21} /></span>
      <h1>{mode === 'register' ? '账户已创建' : '密码已重设'}</h1>
      <p>保存此恢复码，用于重设密码。</p>
      <strong>{issuedRecoveryCode}</strong>
      <button onClick={() => { setIssuedRecoveryCode(''); changeMode('login') }}>{session ? '进入账户' : '返回登录'}</button>
    </section>

    if (mode === 'pending-deletion') return <section className="account-auth-card account-pending-card">
      <span className="account-auth-mark"><ShieldCheck size={24} /></span>
      <h1>账户正在等待删除</h1>
      <p>请前往 Echora Cloud 恢复账户。</p>
      <button className="account-primary-action" onClick={() => void openCloudAccount()}>前往 Echora Cloud</button>
      <button className="account-text-action" onClick={() => changeMode('login')}>返回登录</button>
    </section>

    return <section className="account-auth-card">
      <span className="account-auth-avatar"><BrandMark /></span>
      <h1>{mode === 'register' ? '创建账户' : mode === 'recover' ? '重设密码' : '登录 Echora'}</h1>
      {mode !== 'login' && <p>{mode === 'register' ? '创建后将生成账户恢复码。' : '输入恢复码和新密码。'}</p>}
      <form onSubmit={submitAuth}>
        <label><span>用户名</span><input value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={32} autoComplete="username" disabled={busy || Boolean(pendingChallenge)} required /></label>
        {mode === 'register' && <label><span>显示名称</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={24} autoComplete="nickname" disabled={busy || Boolean(pendingChallenge)} /></label>}
        {mode === 'recover' && <label><span>恢复码</span><input value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} autoComplete="off" disabled={busy || Boolean(pendingChallenge)} required /></label>}
        <label><span>{mode === 'recover' ? '新密码' : '密码'}</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} disabled={busy || Boolean(pendingChallenge)} required /></label>
        {pendingChallenge && <CloudAuthChallenge challenge={pendingChallenge.challenge} onComplete={(token) => {
          const request = pendingChallenge.request
          setPendingChallenge(null)
          void runAuthRequest(request, token)
        }} onError={() => {
          setPendingChallenge(null)
          setStatus('验证服务暂时不可用，请重试')
        }} />}
        <button className="account-primary-action" disabled={busy || Boolean(pendingChallenge) || !online || !username.trim() || password.length < 8 || mode === 'recover' && !recoveryCode.trim()}>{busy ? '处理中' : pendingChallenge ? '等待验证' : mode === 'register' ? '创建账户' : mode === 'recover' ? '重设密码' : '登录'}</button>
      </form>
      {!online && <p className="account-inline-status"><CloudOff size={14} />当前离线</p>}
      {status && <p className={`account-inline-status ${pendingChallenge ? '' : 'is-error'}`} role="status">{status}</p>}
      {mode === 'login' ? <footer className="account-auth-actions"><button onClick={() => changeMode('register')}>创建账户</button><i /><button onClick={() => changeMode('recover')}>忘记密码？</button></footer> : <button className="account-text-action" onClick={() => changeMode('login')}>返回登录</button>}
    </section>
  }

  const renderDashboard = (user: CloudUser) => <div className="account-dashboard-page">
    {!online && <div className="account-offline-banner"><CloudOff size={16} /><span>当前离线，保留本机可用内容</span></div>}
    {syncPhase === 'error' && online && <div className="account-offline-banner"><RefreshCw size={16} /><span>账户服务暂不可用</span></div>}
    <section className="account-identity-section">
      <span className="account-profile-avatar">{user.displayName.slice(0, 1).toLocaleUpperCase()}</span>
      <div><h1>{user.displayName}</h1><p>@{user.username}</p></div>
      <button className="account-profile-edit" onClick={() => { setProfileDraft(user.displayName); setProfileEditing(true); setStatus('') }} aria-label="编辑显示名称"><Pencil size={16} /></button>
    </section>
    {profileEditing && <form className="account-profile-editor" onSubmit={saveProfile}><input value={profileDraft} onChange={(event) => setProfileDraft(event.target.value)} maxLength={32} autoFocus aria-label="显示名称" /><button type="button" onClick={() => setProfileEditing(false)}>取消</button><button type="submit" disabled={busy || !online || !profileDraft.trim()}>保存</button></form>}
    <section className="account-settings-group account-center-group">
      <button onClick={() => void openCloudAccount()}><span className="account-row-icon"><ExternalLink size={17} /></span><span><strong>用户中心</strong><small>资料、安全与设备</small></span><ChevronRight size={17} /></button>
    </section>
    <button className="account-logout-action" onClick={() => void logout()} disabled={busy}><LogOut size={16} /><span>{busy ? '正在退出' : '退出登录'}</span></button>
    {status && <p className="account-page-status" role="status">{status}</p>}
  </div>

  const dialog = presentation === 'dialog'
  return <section ref={rootRef} className={`account-space ${mobile ? 'is-mobile' : ''} ${dialog ? 'is-dialog' : ''}`} role={dialog ? 'dialog' : undefined} aria-modal={dialog || undefined} aria-labelledby="account-space-title">
    <header className="account-space-header">{dialog ? <span /> : <button onClick={onClose} aria-label="返回"><ArrowLeft size={mobile ? 21 : 18} /></button>}<strong id="account-space-title">账户</strong>{dialog ? <button onClick={onClose} aria-label="关闭账户"><X size={18} /></button> : <span />}</header>
    <main>{issuedRecoveryCode ? renderAuth() : session ? renderDashboard(session.user) : renderAuth()}</main>
  </section>
}
