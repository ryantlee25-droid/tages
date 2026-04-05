/**
 * Validates a URL slug parameter.
 * Allows alphanumeric characters and hyphens.
 * Must start and end with an alphanumeric character.
 * Single alphanumeric characters are also valid.
 * Maximum length: 100 characters.
 */
export function isValidSlug(slug: string): boolean {
  if (!slug || slug.length > 100) return false
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(slug)
}
