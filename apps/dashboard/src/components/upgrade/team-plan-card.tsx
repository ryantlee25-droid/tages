'use client'

import { useState } from 'react'

const FEATURES = [
  'Everything in Pro',
  '100,000 memories per project',
  'Team memory federation',
  'RBAC + audit logging',
  'Centralized seat billing',
  'Priority support',
]

export function TeamPlanCard() {
  const [seats, setSeats] = useState(3)

  function handleUpgrade() {
    window.location.href = `/api/stripe/checkout?plan=team&quantity=${seats}`
  }

  return (
    <div className="flex flex-col rounded-xl border border-zinc-800 p-6">
      <h3 className="text-lg font-semibold text-white">Team</h3>
      <div className="mt-2">
        <span className="text-3xl font-bold text-white">$29</span>
        <span className="text-sm text-zinc-500">/seat/mo</span>
      </div>
      <p className="mt-2 text-sm text-zinc-400">For shared codebases.</p>

      <div className="mt-4">
        <label htmlFor="seats" className="block text-sm text-zinc-400">
          Seats
        </label>
        <select
          id="seats"
          value={seats}
          onChange={(e) => setSeats(parseInt(e.target.value, 10))}
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-[#3BA3C7] focus:outline-none"
        >
          {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? 'seat' : 'seats'} — ${n * 29}/mo
            </option>
          ))}
        </select>
      </div>

      <ul className="mt-6 flex-1 space-y-2">
        {FEATURES.map((f) => (
          <li key={f} className="flex items-center gap-2 text-sm text-zinc-300">
            <svg
              className="h-4 w-4 shrink-0"
              style={{ color: '#3BA3C7' }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            {f}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={handleUpgrade}
        className="mt-6 block w-full rounded-lg border border-zinc-700 py-2.5 text-center text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
      >
        Get Team — ${seats * 29}/mo
      </button>
    </div>
  )
}
