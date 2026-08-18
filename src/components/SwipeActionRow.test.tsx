import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SwipeActionRow from './SwipeActionRow'

afterEach(cleanup)

describe('SwipeActionRow', () => {
  it('reveals its action only after a right-to-left swipe', () => {
    const onAction = vi.fn()
    render(<SwipeActionRow ariaLabel="移除测试歌曲" onAction={onAction}><button>测试歌曲</button></SwipeActionRow>)
    const content = screen.getByRole('button', { name: '测试歌曲' }).parentElement!
    const action = document.querySelector('.swipe-action-button') as HTMLButtonElement

    expect(action.getAttribute('aria-hidden')).toBe('true')
    expect(action.getAttribute('tabindex')).toBe('-1')

    fireEvent.touchStart(content, { touches: [{ clientX: 240, clientY: 40 }] })
    fireEvent.touchMove(content, { touches: [{ clientX: 170, clientY: 42 }] })
    fireEvent.touchEnd(content)

    expect(content.getAttribute('style')).toContain('translateX(-72px)')
    expect(action.getAttribute('aria-hidden')).toBe('false')
    fireEvent.click(action)
    expect(onAction).toHaveBeenCalledOnce()
  })

  it('leaves vertical scrolling untouched', () => {
    render(<SwipeActionRow ariaLabel="移除测试歌曲" onAction={vi.fn()}><button>测试歌曲</button></SwipeActionRow>)
    const content = screen.getByRole('button', { name: '测试歌曲' }).parentElement!

    fireEvent.touchStart(content, { touches: [{ clientX: 240, clientY: 40 }] })
    fireEvent.touchMove(content, { touches: [{ clientX: 232, clientY: 100 }] })
    fireEvent.touchEnd(content)

    expect(content.getAttribute('style')).toContain('translateX(0px)')
  })
})
