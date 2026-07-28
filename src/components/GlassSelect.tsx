import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

export type GlassSelectOption<Value extends string> = {
  value: Value
  label: string
  description?: string
  disabled?: boolean
}

type Props<Value extends string> = {
  ariaLabel: string
  value: Value
  options: GlassSelectOption<Value>[]
  onChange: (value: Value) => void
  disabled?: boolean
  className?: string
}

export default function GlassSelect<Value extends string>({ ariaLabel, value, options, onChange, disabled = false, className = '' }: Props<Value>) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const selected = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div ref={rootRef} className={`glass-select ${open ? 'is-open' : ''} ${className}`.trim()}>
      <button
        type="button"
        className="glass-select-trigger"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span><strong>{selected?.label ?? ''}</strong>{selected?.description && <small>{selected.description}</small>}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && <div id={listboxId} className="glass-select-menu" role="listbox" aria-label={`${ariaLabel}选项`}>
        {options.map((option) => <button
          type="button"
          key={option.value}
          role="option"
          aria-selected={option.value === value}
          disabled={option.disabled}
          className={option.value === value ? 'is-selected' : ''}
          onClick={() => {
            onChange(option.value)
            setOpen(false)
          }}
        >
          <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
          {option.value === value && <Check size={15} aria-hidden="true" />}
        </button>)}
      </div>}
    </div>
  )
}
