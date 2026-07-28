import type { LucideIcon } from 'lucide-react'
import { Fragment, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export type ContextMenuItem = {
  label: string
  icon: LucideIcon
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  separatorBefore?: boolean
}

type Props = {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const close = () => onClose()
    document.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus())
    return () => {
      document.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      previouslyFocused?.focus({ preventScroll: true })
    }
  }, [onClose])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault()
      onClose()
      return
    }
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
    if (!buttons.length) return
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement)
    let nextIndex = currentIndex
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % buttons.length
    else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + buttons.length) % buttons.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = buttons.length - 1
    else return
    event.preventDefault()
    buttons[nextIndex]?.focus()
  }

  const left = Math.max(10, Math.min(x, window.innerWidth - 222))
  const separatorCount = items.filter((item) => item.separatorBefore).length
  const top = Math.max(10, Math.min(y, window.innerHeight - items.length * 40 - separatorCount * 7 - 20))

  const menu = (
    <div ref={menuRef} className="context-menu" style={{ left, top }} role="menu" onKeyDown={handleKeyDown} onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
      {items.map((item) => {
        const Icon = item.icon
        return <Fragment key={item.label}>{item.separatorBefore && <div className="context-menu-separator" role="separator" />}<button className={item.danger ? 'is-danger' : ''} disabled={item.disabled} role="menuitem" tabIndex={-1} onClick={() => { item.onSelect(); onClose() }}><Icon size={15} /><span>{item.label}</span></button></Fragment>
      })}
    </div>
  )
  const host = document.querySelector('.client-shell')
  return host ? createPortal(menu, host) : menu
}
