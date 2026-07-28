import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultMusicSourceSettings } from '../appSettings'
import { normalizeMusicSourceCapabilities } from '../musicSource'
import type { MusicSourceStatus } from '../musicSource'
import SourceStatusPanel from './SourceStatusPanel'

afterEach(cleanup)

describe('SourceStatusPanel', () => {
  const readyStatus: MusicSourceStatus = {
    phase: 'ready',
    providers: normalizeMusicSourceCapabilities({ sources: {
      tx: { qualitys: ['128k', '320k', 'flac'] },
      wy: { qualitys: ['128k', '320k'] },
      kw: { qualitys: ['128k', '320k', 'flac', 'flac24bit'] },
      kg: { qualitys: ['128k'] },
    } }).map((provider) => ({ ...provider, catalogStatus: 'available' as const, catalogMessage: '已返回内容', catalogCheckedAt: Date.now() })),
    message: '已连接 4 个音乐平台',
    checkedAt: Date.now(),
    activity: null,
  }

  it('shows verified music service capabilities without exposing source internals', () => {
    const onConfigure = vi.fn()
    const onRefresh = vi.fn()
    render(<SourceStatusPanel settings={defaultMusicSourceSettings} status={readyStatus} onRefresh={onRefresh} onConfigure={onConfigure} />)
    expect(screen.getByText('音乐服务')).toBeTruthy()
    expect(screen.getByText(/高品质优先 · 自动切换平台与音质/)).toBeTruthy()
    expect(screen.queryByText('服务版本')).toBeNull()
    expect(screen.queryByText('lx-玉宁熙')).toBeNull()
    expect(screen.getByText('内容可用')).toBeTruthy()
    expect(screen.getByText('4 / 5 已启用')).toBeTruthy()
    expect(screen.getAllByText('内容可用 · 待播放验证')).toHaveLength(4)
    expect(screen.getByText('QQ 音乐')).toBeTruthy()
    expect(document.querySelector('[data-music-source="tx"]')).toBeTruthy()
    expect(document.querySelector('[data-music-source="wy"]')).toBeTruthy()
    expect(document.querySelector('[data-music-source="kw"]')).toBeTruthy()
    expect(document.querySelector('[data-music-source="kg"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重新连接音乐服务' }))
    expect(onRefresh).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '音乐与播放设置' }))
    expect(onConfigure).toHaveBeenCalledOnce()
  })

  it('surfaces a real runtime failure instead of calling configured state available', () => {
    render(<SourceStatusPanel settings={defaultMusicSourceSettings} status={{ ...readyStatus, phase: 'error', message: '音源初始化超时', providers: normalizeMusicSourceCapabilities({}) }} onRefresh={vi.fn()} onConfigure={vi.fn()} />)
    expect(screen.getByText('不可用')).toBeTruthy()
    expect(screen.getByText('音源初始化超时')).toBeTruthy()
    expect(screen.getByText('0 / 5 已启用')).toBeTruthy()
  })

  it('marks a provider abnormal only after a real playback failure', () => {
    const providers = readyStatus.providers.map((provider) => provider.source === 'kg'
      ? { ...provider, playbackStatus: 'error' as const, playbackMessage: '丑八怪 · 未获取到有效播放链接', playbackCheckedAt: Date.now() }
      : provider)
    render(<SourceStatusPanel settings={defaultMusicSourceSettings} status={{ ...readyStatus, phase: 'degraded', providers, message: '酷狗最近一次播放解析异常' }} onRefresh={vi.fn()} onConfigure={vi.fn()} />)
    expect(screen.getByText('部分异常')).toBeTruthy()
    expect(screen.getByText('4 / 5 已启用 · 1 异常')).toBeTruthy()
    expect(screen.getByText('最近播放异常')).toBeTruthy()
    expect(document.querySelector('[data-music-source="kg"]')?.classList.contains('is-playback-error')).toBe(true)
  })

  it('distinguishes a catalog outage from an unchecked playback path', () => {
    const providers = readyStatus.providers.map((provider) => provider.source === 'kw'
      ? { ...provider, catalogStatus: 'error' as const, catalogMessage: '内容接口响应超时', catalogCheckedAt: Date.now() }
      : provider)
    render(<SourceStatusPanel settings={defaultMusicSourceSettings} status={{ ...readyStatus, phase: 'degraded', providers, message: '1 个音乐平台内容服务异常' }} onRefresh={vi.fn()} onConfigure={vi.fn()} />)
    expect(screen.getByText('内容服务异常')).toBeTruthy()
    expect(document.querySelector('[data-music-source="kw"]')?.getAttribute('title')).toBe('内容接口响应超时')
  })

  it('describes an adaptive provider without presenting it as a normal playback path', () => {
    const providers = readyStatus.providers.map((provider) => provider.source === 'mg'
      ? { ...provider, registered: true, availability: 'limited' as const, qualities: ['128k' as const], catalogStatus: 'available' as const, playbackStatus: 'available' as const }
      : provider)
    render(<SourceStatusPanel settings={defaultMusicSourceSettings} status={{ ...readyStatus, providers }} onRefresh={vi.fn()} onConfigure={vi.fn()} />)
    expect(screen.getByText('部分歌曲自动切换版本')).toBeTruthy()
    expect(document.querySelector('[data-music-source="mg"]')?.classList.contains('is-limited')).toBe(true)
  })
})
