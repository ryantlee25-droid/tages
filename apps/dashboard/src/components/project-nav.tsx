import Link from 'next/link'

const TABS = [
  { key: 'memories', label: 'Memories', href: '' },
  { key: 'decisions', label: 'Decisions', href: '/decisions' },
  { key: 'activity', label: 'Activity', href: '/activity' },
  { key: 'settings', label: 'Settings', href: '/settings' },
]

export function ProjectNav({ slug, active }: { slug: string; active: string }) {
  return (
    <div className="mb-6 flex gap-1 border-b border-zinc-800">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={`/app/projects/${slug}${tab.href}`}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            active === tab.key
              ? 'border-[#3BA3C7] text-white'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  )
}
