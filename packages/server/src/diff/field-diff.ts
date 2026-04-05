/**
 * Field-Level Diffing for Memory Versions
 *
 * Computes which fields changed between two memory snapshots and formats
 * them for display in version timelines.
 */
import type { Memory } from '@tages/shared'

export interface FieldChange {
  field: string
  oldValue: unknown
  newValue: unknown
  changeType: 'added' | 'removed' | 'modified' | 'unchanged'
}

const TRACKED_FIELDS: Array<keyof Memory> = [
  'value',
  'confidence',
  'type',
  'source',
  'status',
  'agentName',
  'filePaths',
  'tags',
  'conditions',
  'phases',
  'crossSystemRefs',
  'executionFlow',
  'examples',
  'verifiedAt',
]

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (a === undefined || b === undefined) return false
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Compute field-level diff between oldMemory and newMemory.
 * Returns only changed fields (excludes timestamps and id).
 */
export function computeFieldDiff(oldMemory: Partial<Memory>, newMemory: Partial<Memory>): FieldChange[] {
  const changes: FieldChange[] = []

  for (const field of TRACKED_FIELDS) {
    const oldVal = (oldMemory as Record<string, unknown>)[field]
    const newVal = (newMemory as Record<string, unknown>)[field]

    if (deepEqual(oldVal, newVal)) continue

    let changeType: FieldChange['changeType']
    if (oldVal === undefined || oldVal === null) {
      changeType = 'added'
    } else if (newVal === undefined || newVal === null) {
      changeType = 'removed'
    } else {
      changeType = 'modified'
    }

    changes.push({ field, oldValue: oldVal, newValue: newVal, changeType })
  }

  return changes
}

/**
 * Format field changes into a human-readable diff string.
 */
export function formatDiff(changes: FieldChange[]): string {
  if (changes.length === 0) return '(no changes)'

  return changes.map(c => {
    const fieldLabel = c.field
    switch (c.changeType) {
      case 'added':
        return `+ ${fieldLabel}: ${formatValue(c.newValue)}`
      case 'removed':
        return `- ${fieldLabel}: ${formatValue(c.oldValue)}`
      case 'modified': {
        const oldStr = formatValue(c.oldValue)
        const newStr = formatValue(c.newValue)
        if (c.field === 'confidence') {
          const oldNum = typeof c.oldValue === 'number' ? c.oldValue : 0
          const newNum = typeof c.newValue === 'number' ? c.newValue : 0
          const delta = newNum - oldNum
          const sign = delta >= 0 ? '+' : ''
          return `~ ${fieldLabel}: ${(oldNum * 100).toFixed(0)}% → ${(newNum * 100).toFixed(0)}% (${sign}${(delta * 100).toFixed(0)}%)`
        }
        return `~ ${fieldLabel}: ${oldStr} → ${newStr}`
      }
      default:
        return `  ${fieldLabel}: ${formatValue(c.newValue)}`
    }
  }).join('\n')
}

function formatValue(val: unknown): string {
  if (val === undefined || val === null) return '(none)'
  if (typeof val === 'string') {
    return val.length > 80 ? val.slice(0, 77) + '...' : val
  }
  if (Array.isArray(val)) {
    return `[${val.join(', ')}]`
  }
  if (typeof val === 'object') {
    const str = JSON.stringify(val)
    return str.length > 80 ? str.slice(0, 77) + '...' : str
  }
  return String(val)
}
