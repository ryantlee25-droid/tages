const TYPE_COLORS: Record<string, string> = {
  convention: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  decision: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  architecture: 'bg-green-500/10 text-green-400 border-green-500/20',
  entity: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  lesson: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  preference: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
  pattern: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  execution: 'bg-red-500/10 text-red-400 border-red-500/20',
  operational: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  environment: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  anti_pattern: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  session_context: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
}

export function TypeBadge({ type }: { type: string }) {
  const colors = TYPE_COLORS[type] || TYPE_COLORS.pattern
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${colors}`}
    >
      {type}
    </span>
  )
}
