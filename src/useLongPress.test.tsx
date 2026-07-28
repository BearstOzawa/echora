import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import useLongPress from './useLongPress'

const LongPressTarget = ({ onLongPress, onClick }: { onLongPress: () => void; onClick: () => void }) => {
  const handlers = useLongPress<HTMLButtonElement>(() => onLongPress())
  return <button {...handlers} onClick={onClick}>歌曲</button>
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useLongPress', () => {
  it('opens a touch action without also firing the normal tap', () => {
    vi.useFakeTimers()
    const onLongPress = vi.fn()
    const onClick = vi.fn()
    render(<LongPressTarget onLongPress={onLongPress} onClick={onClick} />)
    const target = screen.getByRole('button', { name: '歌曲' })

    fireEvent.pointerDown(target, { pointerType: 'touch', pointerId: 1, isPrimary: true, button: 0, clientX: 20, clientY: 30 })
    vi.advanceTimersByTime(520)
    fireEvent.pointerUp(target, { pointerType: 'touch', pointerId: 1, isPrimary: true, button: 0, clientX: 20, clientY: 30 })
    fireEvent.click(target)

    expect(onLongPress).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('cancels when the gesture becomes a scroll', () => {
    vi.useFakeTimers()
    const onLongPress = vi.fn()
    render(<LongPressTarget onLongPress={onLongPress} onClick={vi.fn()} />)
    const target = screen.getByRole('button', { name: '歌曲' })

    fireEvent.pointerDown(target, { pointerType: 'touch', pointerId: 2, isPrimary: true, button: 0, clientX: 20, clientY: 30 })
    fireEvent.pointerMove(target, { pointerType: 'touch', pointerId: 2, isPrimary: true, clientX: 20, clientY: 45 })
    vi.advanceTimersByTime(600)

    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('leaves mouse interaction to click and context-menu handlers', () => {
    vi.useFakeTimers()
    const onLongPress = vi.fn()
    const onClick = vi.fn()
    render(<LongPressTarget onLongPress={onLongPress} onClick={onClick} />)
    const target = screen.getByRole('button', { name: '歌曲' })

    fireEvent.pointerDown(target, { pointerType: 'mouse', pointerId: 3, isPrimary: true, button: 0 })
    vi.advanceTimersByTime(600)
    fireEvent.click(target)

    expect(onLongPress).not.toHaveBeenCalled()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not suppress a later tap when a browser omits the synthetic click', () => {
    vi.useFakeTimers()
    const onClick = vi.fn()
    render(<LongPressTarget onLongPress={vi.fn()} onClick={onClick} />)
    const target = screen.getByRole('button', { name: '歌曲' })

    fireEvent.pointerDown(target, { pointerType: 'touch', pointerId: 4, isPrimary: true, button: 0 })
    vi.advanceTimersByTime(520)
    fireEvent.pointerUp(target, { pointerType: 'touch', pointerId: 4, isPrimary: true, button: 0 })
    vi.advanceTimersByTime(701)
    fireEvent.click(target)

    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
