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
import {
  HOME_PROVIDERS,
  type HomeProvider,
  providerOf,
} from '@/features/home/lib/provider-models'
import type {
  PerformanceGroup,
  PerformanceSeriesPoint,
} from '@/features/performance-metrics/types'

import { EXCLUDED_GROUPS, QUOTA_TYPE_VALUES } from '../constants'
import type { PricingModel } from '../types'
import { isDynamicPricingModel } from './dynamic-price'
import { getConfiguredGroupRatio } from './model-helpers'

export type MeowFamilyId = HomeProvider | 'other'

/** A token group shown as a channel: description, price multiplier and models. */
export type MeowChannel = {
  group: string
  /** Trimmed group description (a server text key), empty when none is set. */
  description: string
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

/** One model's metrics by group, with the end of its 24h window. */
export type MeowModelPerf = {
  windowEnd: number | undefined
  groups: Map<string, PerformanceGroup>
}

/** Per-channel metrics, indexed by model name. */
export type MeowChannelPerf = {
  byModel: Map<string, MeowModelPerf>
}

/** One hour of the 24h status bar; `successRate` is null without traffic. */
export type StatusSlot = {
  ts: number
  successRate: number | null
}

export const STATUS_SLOT_COUNT = 24

const FAMILY_ORDER: MeowFamilyId[] = [...HOME_PROVIDERS, 'other']
const ALL_GROUPS = 'all'
const HOUR_SECONDS = 3600

/**
 * Order inside a channel: token pricing, then expression pricing, then
 * per-request pricing; within each, the dearer base price first.
 */
function catalogRank(model: PricingModel): [number, number] {
  if (isDynamicPricingModel(model)) return [1, 0]
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
        description: description.trim(),
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

/**
 * Map samples onto the 24 hours ending with the hour of `windowEnd`.
 * Sub-hour buckets (minute or 5-minute) are averaged per hour; the mean is
 * unweighted because samples carry no request counts.
 */
export function toStatusSlots(
  series: PerformanceSeriesPoint[],
  windowEnd: number
): StatusSlot[] {
  const lastHour = windowEnd - (windowEnd % HOUR_SECONDS)
  const firstHour = lastHour - (STATUS_SLOT_COUNT - 1) * HOUR_SECONDS
  const ratesByHour = new Map<number, number[]>()
  for (const point of series) {
    if (!Number.isFinite(point.success_rate)) continue
    const hour = point.ts - (point.ts % HOUR_SECONDS)
    if (hour < firstHour || hour > lastHour) continue
    ratesByHour.set(hour, [
      ...(ratesByHour.get(hour) ?? []),
      point.success_rate,
    ])
  }
  return Array.from({ length: STATUS_SLOT_COUNT }, (_, index) => {
    const ts = firstHour + index * HOUR_SECONDS
    const rates = ratesByHour.get(ts)
    if (!rates) return { ts, successRate: null }
    const mean = rates.reduce((sum, rate) => sum + rate, 0) / rates.length
    return { ts, successRate: mean }
  })
}
