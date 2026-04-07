import Link from 'next/link'

export default function AppNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6">
      <h2 className="text-2xl font-bold text-white">Page not found</h2>
      <p className="mt-2 text-zinc-400">
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <Link
        href="/app/projects"
        className="mt-6 rounded-lg px-6 py-2 text-sm font-medium text-white transition-all hover:opacity-90"
        style={{ backgroundColor: '#3BA3C7' }}
      >
        Back to projects
      </Link>
    </div>
  )
}
