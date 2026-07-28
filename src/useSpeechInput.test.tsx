import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useSpeechInput, { parseNativeSpeechEvent } from './useSpeechInput'

const nativeMocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: nativeMocks.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: nativeMocks.listen }))

class FakeRecognition {
  static latest: FakeRecognition | null = null
  lang = ''
  continuous = false
  interimResults = false
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0?: { transcript?: string } }> }) => void) | null = null
  onerror: ((event: { error?: string }) => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn()
  abort = vi.fn()

  constructor() {
    FakeRecognition.latest = this
  }
}

const microphoneTrack = { stop: vi.fn() }

beforeEach(() => {
  nativeMocks.invoke.mockReset().mockResolvedValue(undefined)
  nativeMocks.listen.mockReset()
  Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: FakeRecognition })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [microphoneTrack] }) },
  })
})

afterEach(() => {
  cleanup()
  FakeRecognition.latest = null
  microphoneTrack.stop.mockClear()
  Reflect.deleteProperty(window, 'SpeechRecognition')
  Reflect.deleteProperty(navigator, 'mediaDevices')
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
  Reflect.deleteProperty(navigator, 'userAgent')
})

describe('useSpeechInput', () => {
  it('validates native speech events before they reach the composer', () => {
    expect(parseNativeSpeechEvent('{"type":"transcript","text":"播放爵士乐","final":false,"generation":2}')).toEqual({
      type: 'transcript',
      text: '播放爵士乐',
      final: false,
      generation: 2,
    })
    expect(parseNativeSpeechEvent('{"type":"status","status":"unknown","generation":2}')).toBeNull()
    expect(parseNativeSpeechEvent('{"type":"ended","generation":0}')).toBeNull()
  })

  it('requests microphone access and ignores callbacks from a submitted recording', async () => {
    const onText = vi.fn()
    const { result } = renderHook(() => useSpeechInput(onText))

    await act(async () => { await result.current.start('') })
    const recognition = FakeRecognition.latest!
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(microphoneTrack.stop).toHaveBeenCalledOnce()

    act(() => recognition.onresult?.({ results: [{ isFinal: false, 0: { transcript: '播放一些爵士乐' } }] }))
    expect(onText).toHaveBeenLastCalledWith('播放一些爵士乐')

    act(() => result.current.reset())
    act(() => recognition.onresult?.({ results: [{ isFinal: true, 0: { transcript: '不应再次写入' } }] }))
    expect(onText).toHaveBeenCalledTimes(1)
    expect(result.current.message).toBe('')
  })

  it('routes native iOS recognition events into the current composer text', async () => {
    let receive: ((event: { payload: string }) => void) | undefined
    const unlisten = vi.fn()
    nativeMocks.listen.mockImplementation(async (_event, handler) => {
      receive = handler
      return unlisten
    })
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Echora iPhone' })
    const onText = vi.fn()
    const view = renderHook(() => useSpeechInput(onText))
    await waitFor(() => expect(nativeMocks.listen).toHaveBeenCalledWith('echora://ios-speech', expect.any(Function)))

    await act(async () => { await view.result.current.start('保留这首') })
    expect(nativeMocks.invoke).toHaveBeenCalledWith('start_ios_speech_recognition', { generation: 1 })
    act(() => receive?.({ payload: '{"type":"status","status":"listening","generation":1}' }))
    act(() => receive?.({ payload: '{"type":"transcript","text":"后面降低能量","final":false,"generation":1}' }))
    expect(view.result.current.status).toBe('listening')
    expect(onText).toHaveBeenLastCalledWith('保留这首 后面降低能量')

    act(() => view.result.current.stop())
    await waitFor(() => expect(nativeMocks.invoke).toHaveBeenCalledWith('stop_ios_speech_recognition', undefined))
    act(() => receive?.({ payload: '{"type":"ended","generation":1}' }))
    expect(view.result.current.status).toBe('idle')
    view.unmount()
    expect(unlisten).toHaveBeenCalledOnce()
  })

  it('shows an actionable message when microphone permission is denied', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')) },
    })
    const { result } = renderHook(() => useSpeechInput(vi.fn()))

    await act(async () => { await result.current.start('') })
    expect(result.current.status).toBe('error')
    expect(result.current.message).toContain('系统设置')
  })
})
