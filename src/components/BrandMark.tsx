type Props = { className?: string }

export default function BrandMark({ className = '' }: Props) {
  return <span className={`brand-mark ${className}`.trim()} aria-hidden="true" />
}
