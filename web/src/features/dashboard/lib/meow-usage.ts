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
import { providerOf } from '@/features/home/lib/provider-models'

import { toDateKey } from './meow-checkin'

/** Spend in one time bucket, keyed by series id. */
export type SpendBucket = {
  date: Date
  values: Record<string, number>
  total: number
}

export type UsageItem = {
  model_name?: string
  created_at: number
  quota?: number
}

/** Series id for everything outside Claude and GPT. */
export const OTHER_SERIES = 'other'

export type ModelVendor = 'claude' | 'gpt' | typeof OTHER_SERIES

// OpenAI reasoning models (o1, o3-mini, o4-mini…) carry no "gpt" in the name.
const OPENAI_O_SERIES = /^o\d(?:$|-)/i

/** Claude, GPT or other, from a model name. */
export function modelVendor(model: string): ModelVendor {
  if (OPENAI_O_SERIES.test(model)) return 'gpt'
  return providerOf(model) ?? OTHER_SERIES
}

/** Spend per local day for the given days, split into Claude, GPT and other. */
export function dailyProviderSpend(
  items: UsageItem[],
  days: Date[]
): SpendBucket[] {
  const byDay = new Map<string, SpendBucket>(
    days.map((date) => [toDateKey(date), { date, values: {}, total: 0 }])
  )
  for (const item of items) {
    const quota = Number(item.quota) || 0
    if (quota <= 0) continue
    const bucket = byDay.get(toDateKey(new Date(item.created_at * 1000)))
    if (!bucket) continue
    const vendor = modelVendor(item.model_name ?? '')
    bucket.values[vendor] = (bucket.values[vendor] ?? 0) + quota
    bucket.total += quota
  }
  return [...byDay.values()]
}
