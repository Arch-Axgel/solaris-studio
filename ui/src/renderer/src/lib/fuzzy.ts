/** Fuzzy matching for the command palette (spec 4.16).
 *
 *  A subsequence match: every query character must appear in the text, in
 *  order. Matches earn more for landing on a word start, for running on
 *  consecutively and for an early first hit; gaps cost a little. Returns the
 *  indexes of the matched characters so the row can paint them gold, or null
 *  when the text does not contain the query as a subsequence. */

export interface FuzzyResult {
  score: number
  hits: number[]
}

const SEPARATORS = /[\s\-_/.:,()[\]·›>@#!'’"&+]/

function isWordStart(text: string, i: number): boolean {
  if (i === 0) return true
  const prev = text[i - 1]
  if (SEPARATORS.test(prev)) return true
  // camelCase boundary: "ClipEditor" → E
  const ch = text[i]
  return prev === prev.toLowerCase() && ch !== ch.toLowerCase()
}

/** Greedy pass from a given start; picks word-start hits when one is near. */
function pass(q: string, text: string, lower: string, start: number): FuzzyResult | null {
  const hits: number[] = []
  let ti = start
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    if (ch === ' ') continue
    let found = -1
    // prefer a word start within the next stretch over the first plain hit
    let plain = -1
    for (let j = ti; j < lower.length; j++) {
      if (lower[j] !== ch) continue
      if (plain < 0) plain = j
      const consecutive = hits.length > 0 && hits[hits.length - 1] === j - 1
      if (consecutive || isWordStart(text, j)) {
        found = j
        break
      }
      if (j - plain > 24) break
    }
    if (found < 0) found = plain
    if (found < 0) return null
    hits.push(found)
    ti = found + 1
  }
  if (hits.length === 0) return null
  let score = 0
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i]
    score += 1
    if (isWordStart(text, h)) score += 6
    if (i > 0 && hits[i - 1] === h - 1) score += 5
    if (i > 0) score -= Math.min(4, (h - hits[i - 1] - 1) * 0.25)
  }
  score -= hits[0] * 0.15
  // a full prefix match reads as the obvious answer
  if (lower.startsWith(q)) score += 12
  // shorter texts win ties: "Queue" before "Queue settings"
  score -= text.length * 0.02
  return { score, hits }
}

export function score(query: string, text: string): FuzzyResult | null {
  const q = query.trim().toLowerCase()
  if (!q) return { score: 0, hits: [] }
  if (!text) return null
  const lower = text.toLowerCase()
  // quick reject: every character must be present
  let k = 0
  for (let i = 0; i < lower.length && k < q.length; i++) {
    if (q[k] === ' ') k++
    if (lower[i] === q[k]) k++
  }
  while (k < q.length && q[k] === ' ') k++
  if (k < q.length) return null

  // try starting at each word start that matches the first character, keep the best
  const first = q.replace(/\s/g, '')[0]
  let best: FuzzyResult | null = pass(q, text, lower, 0)
  let tries = 0
  for (let i = 1; i < lower.length && tries < 6; i++) {
    if (lower[i] !== first || !isWordStart(text, i)) continue
    tries++
    const r = pass(q, text, lower, i)
    if (r && (!best || r.score > best.score)) best = r
  }
  return best
}

/** Best score across a label and extra keywords; hits refer to the label only. */
export function scoreAll(query: string, label: string, keywords?: string[]): FuzzyResult | null {
  const main = score(query, label)
  let best = main
  if (keywords) {
    for (const k of keywords) {
      const r = score(query, k)
      if (r && (!best || r.score - 3 > best.score)) best = { score: r.score - 3, hits: main?.hits ?? [] }
    }
  }
  return best
}
