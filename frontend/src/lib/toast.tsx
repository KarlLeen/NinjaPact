import { useState, createContext, useContext, useCallback, type ReactNode } from 'react'

type ToastType = 'success' | 'error' | 'info'
interface Toast { id: number; msg: string; type: ToastType }

const ToastCtx = createContext<(msg: string, type?: ToastType) => void>(() => {})

export function useToast() { return useContext(ToastCtx) }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  let seq = 0

  const show = useCallback((msg: string, type: ToastType = 'info') => {
    const id = ++seq
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
  }, [])

  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
