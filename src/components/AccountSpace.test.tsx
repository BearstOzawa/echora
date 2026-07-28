import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudApiError, cloudAuth, productionCloudUrl } from '../cloudApi'
import { detectRuntimeCapabilities } from '../runtimeCapabilities'
import AccountSpace from './AccountSpace'

const cloudState = vi.hoisted(() => ({ session: null as any, online: true, syncPhase: 'current' as const }))

vi.mock('../useCloudSession', () => ({ useCloudSession: () => cloudState }))

const profile = { id: 'local-test', displayName: '访客', createdAt: 1 }

afterEach(() => {
  cleanup()
  localStorage.clear()
  cloudState.session = null
  cloudState.online = true
  vi.restoreAllMocks()
})

describe('AccountSpace', () => {
  it('uses login as the primary flow and keeps registration and recovery secondary', () => {
    render(<AccountSpace presentation="dialog" profile={profile} runtime={detectRuntimeCapabilities()} onProfileChange={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: '账户' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '登录 Echora' })).toBeTruthy()
    expect(screen.queryByRole('tablist')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '创建账户' }))
    expect(screen.getByRole('heading', { name: '创建账户' })).toBeTruthy()
    expect(screen.getByLabelText('显示名称')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '返回登录' }))
    fireEvent.click(screen.getByRole('button', { name: '忘记密码？' }))
    expect(screen.getByRole('heading', { name: '重设密码' })).toBeTruthy()
    expect(screen.getByLabelText('恢复码')).toBeTruthy()
  })

  it('keeps account management in the cloud user center', () => {
    const user = { id: 'user-1', username: 'listener', displayName: '聆听者', role: 'user' as const, avatarUrl: null, createdAt: 1 }
    cloudState.session = { token: 'token', user }

    render(<AccountSpace profile={{ id: user.id, displayName: user.displayName, createdAt: user.createdAt }} runtime={detectRuntimeCapabilities()} onProfileChange={vi.fn()} onClose={vi.fn()} />)

    expect(screen.getByRole('heading', { name: '聆听者' })).toBeTruthy()
    expect(screen.getByText('@listener')).toBeTruthy()
    expect(screen.queryByText('歌单')).toBeNull()
    expect(screen.queryByText('AI 模式')).toBeNull()
    expect(screen.queryByText('账户内容')).toBeNull()
    expect(screen.queryByText('当前终端')).toBeNull()
    expect(screen.getByRole('button', { name: /用户中心/ })).toBeTruthy()
    expect(screen.queryByText('修改密码')).toBeNull()
    expect(screen.queryByText('删除账户')).toBeNull()
    expect(screen.queryByText('设备')).toBeNull()
  })

  it('edits the display name without leaving the client', async () => {
    const user = { id: 'user-edit', username: 'listener', displayName: '聆听者', role: 'user' as const, avatarUrl: null, createdAt: 1 }
    cloudState.session = { token: 'token', user }
    const updated = { ...user, displayName: '新的名字' }
    vi.spyOn(cloudAuth, 'updateProfile').mockResolvedValue(updated)
    const onProfileChange = vi.fn()
    render(<AccountSpace profile={{ id: user.id, displayName: user.displayName, createdAt: user.createdAt }} runtime={detectRuntimeCapabilities()} onProfileChange={onProfileChange} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '编辑显示名称' }))
    fireEvent.change(screen.getByRole('textbox', { name: '显示名称' }), { target: { value: '新的名字' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(cloudAuth.updateProfile).toHaveBeenCalledWith('新的名字'))
    expect(onProfileChange).toHaveBeenCalledWith({ id: user.id, displayName: '新的名字', createdAt: 1 })
  })

  it('keeps the account signed in when offline changes are still pending', async () => {
    const user = { id: 'user-pending', username: 'listener', displayName: '聆听者', role: 'user' as const, avatarUrl: null, createdAt: 1 }
    cloudState.session = { token: 'token', user }
    cloudState.online = false
    localStorage.setItem(`echora.cloudOutbox.v1:${user.id}`, JSON.stringify([{ operationId: 'pending-1' }]))
    const logout = vi.spyOn(cloudAuth, 'logout').mockResolvedValue()

    render(<AccountSpace profile={{ id: user.id, displayName: user.displayName, createdAt: user.createdAt }} runtime={detectRuntimeCapabilities()} onProfileChange={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^退出登录$/ }))

    expect(await screen.findByText('仍有未提交的账户更改，请联网后再退出')).toBeTruthy()
    expect(logout).not.toHaveBeenCalled()
  })

  it('shows a Cloud-hosted challenge and retries the terminal login automatically', async () => {
    const user = { id: 'user-verified', username: 'listener', displayName: '聆听者', role: 'user' as const, avatarUrl: null, createdAt: 1 }
    const challenge = { provider: 'turnstile' as const, siteKey: 'site-key', action: 'login' as const }
    const login = vi.spyOn(cloudAuth, 'login')
      .mockRejectedValueOnce(new CloudApiError(403, 'challenge_required', '需要完成人机验证', { challenge }))
      .mockResolvedValueOnce({ token: 'session-token', user })
    const onProfileChange = vi.fn()
    render(<AccountSpace presentation="dialog" profile={profile} runtime={detectRuntimeCapabilities()} onProfileChange={onProfileChange} onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'listener' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'initial-password' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    const frame = await screen.findByTitle('安全验证') as HTMLIFrameElement
    expect((screen.getByRole('button', { name: '等待验证' }) as HTMLButtonElement).disabled).toBe(true)
    const challengeUrl = new URL(frame.src)
    const message = new MessageEvent('message', {
      data: { type: 'echora:turnstile', nonce: challengeUrl.searchParams.get('nonce'), action: 'login', token: 'turnstile-token' },
      origin: productionCloudUrl,
    })
    Object.defineProperty(message, 'source', { value: frame.contentWindow })
    window.dispatchEvent(message)

    await waitFor(() => expect(login).toHaveBeenCalledTimes(2))
    expect(login).toHaveBeenLastCalledWith('listener', 'initial-password', 'turnstile-token')
    expect(onProfileChange).toHaveBeenCalledWith({ id: user.id, displayName: user.displayName, createdAt: 1 })
  })
})
