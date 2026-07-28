import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

type Props = {
  icon: LucideIcon
  eyebrow: string
  title: string
  actions?: ReactNode
  className?: string
}

export default function WorkspaceHeader({ icon: Icon, eyebrow, title, actions, className = '' }: Props) {
  return (
    <header className={`workspace-header ${className}`.trim()}>
      <div className="workspace-heading-title">
        <span className="workspace-heading-icon"><Icon size={18} /></span>
        <div className="workspace-heading-copy">
          <span className="mono-label">{eyebrow}</span>
          <h1>{title}</h1>
        </div>
      </div>
      {actions && <div className="workspace-header-actions">{actions}</div>}
    </header>
  )
}
