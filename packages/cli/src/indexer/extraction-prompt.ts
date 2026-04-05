export const EXTRACTION_PROMPT = `Extract any architectural decisions, new naming patterns, convention changes, or key entity definitions from this git diff. Return a JSON array of objects with fields: key (string), value (string), type (one of: convention, decision, architecture, entity, lesson), files_affected (string array). Return only the JSON array, no other text.`

export function buildPrompt(diff: string): string {
  return `${EXTRACTION_PROMPT}\n\n---\n\n${diff}`
}
