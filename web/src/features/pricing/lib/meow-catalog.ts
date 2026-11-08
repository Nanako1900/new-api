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
import type {
  PerformanceGroup,
  PerformanceSeriesPoint,
} from '@/features/performance-metrics/types'

import { EXCLUDED_GROUPS, QUOTA_TYPE_VALUES } from '../constants'
import type { PricingModel } from '../types'
import { getConfiguredGroupRatio } from './model-helpers'

export type MeowFamilyId = 'claude' | 'gpt' | 'other'

/** A token group shown as a channel: label, price multiplier and models. */
export type MeowChannel = {
  group: string
  label: string
  ratio: number
  models: PricingModel[]
}

export type MeowFamily = {
  id: MeowFamilyId
  channels: MeowChannel[]
}

/**
 * Usable groups as `/api/pricing` sends them: group name → description.
 * The shared `PricingData` type declares objects, so both shapes are read.
 */
export type MeowUsableGroups = Record<
  string,
  string | { desc?: string; ratio?: number }
>

/** Per-channel metrics: model name → group → metrics, plus the window end. */
export type MeowChannelPerf = {
  byModel: Map<string, Map<string, PerformanceGroup>>
  windowEnd: number | undefined
}

/** One hour of the 24h status bar; `successRate` is null without traffic. */
export type StatusSlot = {
  ts: number
  successRate: number | null
}

export const STATUS_SLOT_COUNT = 24

const FAMILY_ORDER: MeowFamilyId[] = ['claude', 'gpt', 'other']
const ALL_GROUPS = 'all'
const HOUR_SECONDS = 3600

/**
 * Order inside a channel: token pricing, then expression pricing, then
 * per-request pricing; within each, the dearer base price first.
 */
function catalogRank(model: PricingModel): [number, number] {
  if (model.billing_mode === 'tiered_expr' && model.billing_expr) return [1, 0]
  if (model.quota_type === QUOTA_TYPE_VALUES.REQUEST) {
    return [2, model.model_price ?? 0]
  }
  return [0, model.model_ratio]
}

/** Families (Claude, GPT, other) → channels (usable groups) → models. */
export function buildMeowCatalog(
  models: PricingModel[],
  usableGroup: MeowUsableGroups,
  groupRatio: Record<string, number>
): MeowFamily[] {
  const channels = Object.entries(usableGroup)
    .filter(([group]) => !EXCLUDED_GROUPS.includes(group))
    .map(([group, info]) => {
      const description = typeof info === 'string' ? info : (info.desc ?? '')
      return {
        group,
        label: description.trim() || group,
        ratio: getConfiguredGroupRatio(groupRatio, group),
      }
    })
    .sort((a, b) => b.ratio - a.ratio || a.group.localeCompare(b.group))

  const sortedModels = [...models].sort((a, b) => {
    const [tierA, priceA] = catalogRank(a)
    const [tierB, priceB] = catalogRank(b)
    return (
      tierA - tierB ||
      priceB - priceA ||
      a.model_name.localeCompare(b.model_name)
    )
  })

  return FAMILY_ORDER.flatMap((id): MeowFamily[] => {
    const familyModels = sortedModels.filter(
      (model) =>
        (providerOf(model.model_name, model.vendor_name) ?? 'other') === id
    )
    const familyChannels = channels
      .map((channel) => ({
        ...channel,
        models: familyModels.filter((model) =>
          (model.enable_groups ?? []).some(
            (group) => group === channel.group || group === ALL_GROUPS
          )
        ),
      }))
      .filter((channel) => channel.models.length > 0)
    return familyChannels.length > 0 ? [{ id, channels: familyChannels }] : []
  })
}

/** Map hourly samples onto the 24 hours ending with the hour of `windowEnd`. */
export function toStatusSlots(
  series: PerformanceSeriesPoint[],
  windowEnd: number
): StatusSlot[] {
  const lastHour = windowEnd - (windowEnd % HOUR_SECONDS)
  const firstHour = lastHour - (STATUS_SLOT_COUNT - 1) * HOUR_SECONDS
  const rates = new Map<number, number>()
  for (const point of series) {
    if (point.ts < firstHour || point.ts > lastHour) continue
    if (!Number.isFinite(point.success_rate)) continue
    rates.set(point.ts, point.success_rate)
  }
  return Array.from({ length: STATUS_SLOT_COUNT }, (_, index) => {
    const ts = firstHour + index * HOUR_SECONDS
    return { ts, successRate: rates.get(ts) ?? null }
  })
}
