import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Play, Trash2 } from 'lucide-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ContextMenu from './ContextMenu'

afterEach(cleanup)

describe('ContextMenu', () => {
  it('focuses the first enabled action and supports menu navigation', async () => {
    render(<ContextMenu x={20} y={20} onClose={vi.fn()} items={[
      { label: '不可用', icon: Play, disabled: true, onSelect: vi.fn() },
      { label: '立即播放', icon: Play, onSelect: vi.fn() },
      { label: '删除', icon: Trash2, onSelect: vi.fn() },
    ]} />)

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '立即播放' })))
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '删除' }))
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Home' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '立即播放' }))
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '删除' }))
  })

  it('selects actions and closes the menu', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<ContextMenu x={20} y={20} onClose={onClose} items={[{ label: '立即播放', icon: Play, onSelect }]} />)
    fireEvent.click(screen.getByRole('menuitem', { name: '立即播放' }))
    expect(onSelect).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<ContextMenu x={20} y={20} onClose={onClose} items={[{ label: '立即播放', icon: Play, onSelect: vi.fn() }]} />)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes an all-disabled menu on Escape', () => {
    const onClose = vi.fn()
    render(<ContextMenu x={20} y={20} onClose={onClose} items={[{ label: '不可用', icon: Play, disabled: true, onSelect: vi.fn() }]} />)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
