import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { fillPercent } from '../lib/format'

export function Switch({
  checked,
  onChange,
  title,
  hint,
  disabled
}: {
  checked: boolean
  onChange: (value: boolean) => void
  title: string
  hint?: string
  disabled?: boolean
}): ReactNode {
  return (
    <button
      className="switch"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={disabled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
    >
      <span className="switch__text">
        <span className="switch__title">{title}</span>
        {hint ? <span className="switch__hint">{hint}</span> : null}
      </span>
      <span className="switch__track" data-on={checked}>
        <span className="switch__knob" />
      </span>
    </button>
  )
}

export function Slider({
  value,
  min,
  max,
  step = 0.01,
  onChange,
  disabled,
  'aria-label': ariaLabel
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  disabled?: boolean
  'aria-label'?: string
}): ReactNode {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onChange(Number(event.target.value))}
      style={{ ['--fill' as string]: fillPercent(value, min, max) }}
    />
  )
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 560
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}): ReactNode {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: width }} role="dialog" aria-modal="true">
        <div className="modal__head">
          <div>
            <div className="modal__title">{title}</div>
            {subtitle ? <div className="modal__sub">{subtitle}</div> : null}
          </div>
          <button className="btn btn--ghost btn--icon btn--sm" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__foot">{footer}</div> : null}
      </div>
    </div>
  )
}

export interface MenuItem {
  label: string
  icon?: ReactNode
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
  shortcut?: string
  separator?: boolean
}

export function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x, y })

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    // Flip the menu back inside the window when it would overflow.
    setPosition({
      x: Math.min(x, window.innerWidth - rect.width - 8),
      y: Math.min(y, window.innerHeight - rect.height - 8)
    })
  }, [x, y])

  useEffect(() => {
    const dismiss = (): void => onClose()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', dismiss)
    window.addEventListener('resize', dismiss)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', dismiss)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="menu"
      style={{ left: position.x, top: position.y }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {items.map((item, index) =>
        item.separator ? (
          <div key={`sep-${index}`} className="menu__sep" />
        ) : (
          <button
            key={item.label}
            className="menu__item"
            data-danger={item.danger}
            data-disabled={item.disabled}
            onClick={() => {
              item.onClick?.()
              onClose()
            }}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.shortcut ? <span className="menu__key">{item.shortcut}</span> : null}
          </button>
        )
      )}
    </div>
  )
}

export function Field({
  label,
  value,
  children
}: {
  label: string
  value?: string
  children: ReactNode
}): ReactNode {
  return (
    <div className="field">
      <div className="field__label">
        <span>{label}</span>
        {value !== undefined ? <span className="field__value">{value}</span> : null}
      </div>
      {children}
    </div>
  )
}

export function Card({
  title,
  subtitle,
  icon,
  children,
  action
}: {
  title: string
  subtitle?: string
  icon?: ReactNode
  children: ReactNode
  action?: ReactNode
}): ReactNode {
  return (
    <section className="card">
      <header className="card__head">
        {icon ? <span className="card__icon">{icon}</span> : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="card__title">{title}</div>
          {subtitle ? <div className="card__sub">{subtitle}</div> : null}
        </div>
        {action}
      </header>
      <div className="card__body">{children}</div>
    </section>
  )
}

export function Row({
  title,
  hint,
  children
}: {
  title: string
  hint?: string
  children: ReactNode
}): ReactNode {
  return (
    <div className="row">
      <div className="row__text">
        <div className="row__title">{title}</div>
        {hint ? <div className="row__hint">{hint}</div> : null}
      </div>
      <div>{children}</div>
    </div>
  )
}
