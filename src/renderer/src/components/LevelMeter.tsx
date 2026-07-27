import type { ReactNode } from 'react'

export function LevelMeter({
  label,
  level,
  disabled,
  title
}: {
  label: string
  level: number
  disabled?: boolean
  title?: string
}): ReactNode {
  return (
    <div className="meter" title={title}>
      <span className="meter__label">{label}</span>
      <div className="meter__track" data-off={disabled}>
        <div
          className="meter__fill"
          style={{ width: `${Math.round((disabled ? 0 : level) * 100)}%` }}
        />
      </div>
    </div>
  )
}
