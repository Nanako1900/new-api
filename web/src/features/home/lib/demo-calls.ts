/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import type { HomeProvider } from './provider-models'

/** One illustrative row in the key card's call log. */
export type DemoCall = {
  provider: HomeProvider
  model: string
  tokens: number
  latencyMs: number
}

// Fixed sizes keep the illustration stable between renders and sites.
const CALL_SHAPES: Omit<DemoCall, 'model'>[] = [
  { provider: 'claude', tokens: 1284, latencyMs: 812 },
  { provider: 'gpt', tokens: 862, latencyMs: 640 },
  { provider: 'claude', tokens: 2410, latencyMs: 1460 },
  { provider: 'gpt', tokens: 530, latencyMs: 380 },
  { provider: 'claude', tokens: 940, latencyMs: 290 },
  { provider: 'gpt', tokens: 1730, latencyMs: 920 },
]

const FALLBACK_MODEL: Record<HomeProvider, string> = {
  claude: 'claude',
  gpt: 'gpt',
}

/**
 * Demo calls named after the site's own models: each provider's rows take
 * its listed models in turn, or the bare family name when it lists none.
 */
export function buildDemoCalls(
  modelsByProvider: Record<HomeProvider, string[]>
): DemoCall[] {
  const nextIndex: Record<HomeProvider, number> = { claude: 0, gpt: 0 }
  return CALL_SHAPES.map((shape) => {
    const names = modelsByProvider[shape.provider]
    if (names.length === 0) {
      return { ...shape, model: FALLBACK_MODEL[shape.provider] }
    }
    const model = names[nextIndex[shape.provider] % names.length]
    nextIndex[shape.provider] += 1
    return { ...shape, model }
  })
}

/**
 * The rows on screen when `head` calls have arrived: newest first, wrapping
 * around the list. `seq` grows with every arrival, so it is a stable key.
 */
export function visibleDemoCalls(
  calls: DemoCall[],
  head: number,
  count: number
): Array<DemoCall & { seq: number }> {
  if (calls.length === 0) return []
  const rows: Array<DemoCall & { seq: number }> = []
  for (let offset = 0; offset < Math.min(count, calls.length); offset += 1) {
    const seq = head - offset
    const index = ((seq % calls.length) + calls.length) % calls.length
    rows.push({ ...calls[index], seq })
  }
  return rows
}
