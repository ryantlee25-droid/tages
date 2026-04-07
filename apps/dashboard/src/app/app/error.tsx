'use client'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6">
      <h2 className="text-2xl font-bold text-white">Something went wrong</h2>
      <p className="mt-2 text-zinc-400">
        {error.message || 'An unexpected error occurred.'}
      </p>
      <button
        onClick={reset}
        className="mt-6 rounded-lg px-6 py-2 text-sm font-medium text-white transition-all hover:opacity-90"
        style={{ backgroundColor: '#3BA3C7' }}
      >
        Try again
      </button>
    </div>
  )
}
