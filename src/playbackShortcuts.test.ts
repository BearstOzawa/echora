import { describe, expect, it } from 'vitest'
import { resolvePlaybackShortcut } from './playbackShortcuts'

const shortcut = (key: string, overrides: Partial<KeyboardEvent> = {}) => resolvePlaybackShortcut({
  key,
  code: key === ' ' ? 'Space' : '',
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  repeat: false,
  target: document.body,
  ...overrides,
})

describe('song mode playback shortcuts', () => {
  it('maps common transport, seek, volume, mute, and exit keys', () => {
    expect(shortcut(' ')).toEqual({ type: 'toggle-playback' })
    expect(shortcut('ArrowLeft')).toEqual({ type: 'seek-by', seconds: -5 })
    expect(shortcut('ArrowRight', { shiftKey: true })).toEqual({ type: 'next-track' })
    expect(shortcut('ArrowUp')).toEqual({ type: 'change-volume', amount: 5 })
    expect(shortcut('m')).toEqual({ type: 'toggle-mute' })
    expect(shortcut('Home')).toEqual({ type: 'seek-to', progress: 0 })
    expect(shortcut('Escape')).toEqual({ type: 'exit-song-mode' })
  })

  it('supports hardware media keys', () => {
    expect(shortcut('MediaPlayPause')).toEqual({ type: 'toggle-playback' })
    expect(shortcut('MediaTrackPrevious')).toEqual({ type: 'previous-track' })
    expect(shortcut('AudioVolumeDown')).toEqual({ type: 'change-volume', amount: -5 })
  })

  it('uses the configured seek step without changing discrete shortcuts', () => {
    const input = { key: 'ArrowRight', code: '', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, target: document.body }
    expect(resolvePlaybackShortcut(input, 15)).toEqual({ type: 'seek-by', seconds: 15 })
    expect(resolvePlaybackShortcut({ ...input, shiftKey: true }, 15)).toEqual({ type: 'next-track' })
  })

  it('does not intercept controls, text fields, modified keys, or repeated discrete actions', () => {
    const input = document.createElement('input')
    expect(shortcut(' ', { target: input })).toBeNull()
    expect(shortcut('ArrowRight', { ctrlKey: true })).toBeNull()
    expect(shortcut('m', { repeat: true })).toBeNull()
  })
})
