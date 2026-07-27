import type { ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { useStore } from '../state/store'

export function Toasts(): ReactNode {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)

  if (!toasts.length) return null

  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast" data-tone={toast.tone}>
          {toast.tone === 'success' ? (
            <CircleCheck />
          ) : toast.tone === 'error' ? (
            <CircleAlert />
          ) : (
            <Info />
          )}
          <span style={{ flex: 1 }}>{toast.message}</span>
          <button
            onClick={() => dismiss(toast.id)}
            style={{ color: 'var(--text-faint)', display: 'grid', placeItems: 'center' }}
            aria-label="Dismiss"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
