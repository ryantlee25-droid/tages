'use client'

import { createContext, useContext, useReducer, useEffect, useCallback } from 'react'

type Variant = 'success' | 'error' | 'info'

interface Toast {
  id: string
  message: string
  variant: Variant
}

type Action =
  | { type: 'ADD'; toast: Toast }
  | { type: 'REMOVE'; id: string }

const ToastContext = createContext<{ toast: (msg: string, variant: Variant) => void } | null>(null)

function reducer(state: Toast[], action: Action): Toast[] {
  if (action.type === 'ADD') return [...state, action.toast]
  if (action.type === 'REMOVE') return state.filter((t) => t.id !== action.id)
  return state
}

const variantClass: Record<Variant, string> = {
  success: 'bg-zinc-900 border-green-500/40 text-green-400',
  error: 'bg-zinc-900 border-red-500/40 text-red-400',
  info: 'bg-zinc-900 border-blue-500/40 text-blue-400',
}

function ToastItem({ t, dispatch }: { t: Toast; dispatch: React.Dispatch<Action> }) {
  useEffect(() => {
    const timer = setTimeout(() => dispatch({ type: 'REMOVE', id: t.id }), 4000)
    return () => clearTimeout(timer)
  }, [t.id, dispatch])

  return (
    <div className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg ${variantClass[t.variant]}`}>
      <span className="flex-1">{t.message}</span>
      <button onClick={() => dispatch({ type: 'REMOVE', id: t.id })} className="ml-2 opacity-60 hover:opacity-100">✕</button>
    </div>
  )
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, dispatch] = useReducer(reducer, [])

  const toast = useCallback((message: string, variant: Variant) => {
    dispatch({ type: 'ADD', toast: { id: crypto.randomUUID(), message, variant } })
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80">
        {toasts.map((t) => <ToastItem key={t.id} t={t} dispatch={dispatch} />)}
      </div>
    </ToastContext.Provider>
  )
}

export function Toaster() {
  return null // Toaster is rendered inside ToastProvider
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
