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
  isSecondaryModel,
  providerOf,
} from './provider-models'

type PerfModel = {
  model_name: string
  success_rate: number
  avg_latency_ms: number
}

type VendorModel = {
  model_name?: string
  vendor_name?: string
}

export type ProviderHealth = {
  /** 0-100 */
  successRate: number
  avgLatencyMs: number
}

/** The lowest success rate (0-100) the home page still shows live numbers for. */
export const LIVE_STATUS_MIN_SUCCESS_RATE = 95

/**
 * Whether the home status bar shows live numbers: every home provider has
 * measurements and none is below the minimum success rate. Otherwise the
 * bar shows the service promises instead.
 */
export function canShowLiveStatus(
  health: Record<HomeProvider, ProviderHealth | null>
): health is Record<HomeProvider, ProviderHealth> {
  return HOME_PROVIDERS.every((provider) => {
    const item = health[provider]
    return item !== null && item.successRate >= LIVE_STATUS_MIN_SUCCESS_RATE
  })
}

/**
 * Per-provider success rate and latency, read from each provider's busiest
 * chat model, or its busiest image / audio / embedding model when it has no
 * chat traffic. The summary lists models busiest first
 * (pkg/perf_metrics QuerySummaryAll) but does not publish their request
 * counts, so averaging across models would let a rarely used model at 0%
 * sink a provider whose traffic is healthy. A provider with no measured
 * models maps to null.
 */
export function summarizeProviderHealth(
  perfModels: PerfModel[],
  vendorModels: VendorModel[]
): Record<HomeProvider, ProviderHealth | null> {
  const vendorByModel = new Map<string, string>()
  for (const model of vendorModels) {
    if (model.model_name && model.vendor_name) {
      vendorByModel.set(model.model_name, model.vendor_name)
    }
  }

  const chat: Partial<Record<HomeProvider, PerfModel>> = {}
  const secondary: Partial<Record<HomeProvider, PerfModel>> = {}
  for (const model of perfModels) {
    const provider = providerOf(
      model.model_name,
      vendorByModel.get(model.model_name)
    )
    if (!provider || !Number.isFinite(model.success_rate)) continue
    const busiest = isSecondaryModel(model.model_name) ? secondary : chat
    busiest[provider] ??= model
  }

  const result = {} as Record<HomeProvider, ProviderHealth | null>
  for (const provider of HOME_PROVIDERS) {
    const model = chat[provider] ?? secondary[provider]
    if (!model) {
      result[provider] = null
      continue
    }
    const hasLatency =
      Number.isFinite(model.avg_latency_ms) && model.avg_latency_ms > 0
    result[provider] = {
      successRate: model.success_rate,
      avgLatencyMs: hasLatency ? model.avg_latency_ms : Number.NaN,
    }
  }
  return result
}
