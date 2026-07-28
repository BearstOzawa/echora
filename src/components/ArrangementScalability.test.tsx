import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Track } from '../types'
import FieldCanvas from './FieldCanvas'
import MobileArrangement from './MobileArrangement'

const tracks = (count: number): Track[] => Array.from({ length: count }, (_, index) => ({
  id: index + 1,
  title: `歌曲 ${index + 1}`,
  artist: `艺人 ${index + 1}`,
  album: '测试专辑',
  duration: '3:30',
  durationSeconds: 210,
  source: 'QQ',
  quality: '高品质',
  cover: '/brand-mark.svg',
  bpm: 90 + index,
  musicalKey: 'C',
  x: 10 + index * (80 / Math.max(1, count - 1)),
  y: 30 + index % 5 * 8,
  offline: false,
  verified: true,
  sizeMb: 8,
}))

const actions = {
  onPlayTrack: vi.fn(),
  onMoveTrack: vi.fn(),
  onReorderTrack: vi.fn(),
  onReorderTrackTo: vi.fn(),
  onRemoveTrack: vi.fn(),
  onOpenNowPlaying: vi.fn(),
}

describe('arrangement scalability', () => {
  it('uses the sequence list by default for a long desktop arrangement', () => {
    render(<FieldCanvas embedded tracks={tracks(24)} activeTrackId={1} isPlaying={false} title="长编排" durationMinutes={84} commandBar={null} {...actions} />)
    expect(screen.getByRole('list', { name: '当前编排，共 24 首' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '使用顺序列表' }).classList.contains('is-active')).toBe(true)
  })

  it('reorders the desktop sequence list by dragging its handle', () => {
    const onReorderTrackTo = vi.fn()
    const view = render(<FieldCanvas embedded tracks={tracks(24)} activeTrackId={1} isPlaying={false} title="长编排" durationMinutes={84} commandBar={null} {...actions} onReorderTrackTo={onReorderTrackTo} />)
    const handle = view.container.querySelector<HTMLButtonElement>('[aria-label="拖动调整 歌曲 1 的顺序"]')!
    fireEvent.pointerDown(handle, { button: 0, clientY: 80, pointerId: 1 })
    fireEvent.pointerMove(window, { clientY: 150, pointerId: 1 })
    fireEvent.pointerUp(window, { pointerId: 1 })
    expect(onReorderTrackTo).toHaveBeenCalledWith(1, 1)
  })

  it('keeps every mobile track while aggregating the energy overview', () => {
    const { container } = render(<MobileArrangement tracks={tracks(50)} activeTrackId={25} isPlaying durationMinutes={175} {...actions} />)
    expect(container.querySelectorAll('.mobile-arrangement-track')).toHaveLength(50)
    expect(container.querySelectorAll('.mobile-arrangement-energy i')).toHaveLength(36)
    expect(container.querySelector('.mobile-arrangement')?.classList.contains('is-long')).toBe(true)
    expect(screen.getByRole('button', { name: '定位正在播放的 歌曲 25' })).toBeTruthy()
  })
})
