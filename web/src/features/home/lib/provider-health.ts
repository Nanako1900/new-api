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
import { type HomeProvider, providerOf } from './provider-models'

type PerfModel = {
  model_name: string
  success_rate: number
  avg_latency_ms: number
  request_count?: number
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

/**
 * Per-provider success rate and latency from the per-model performance
 * summary, weighted by request count when the server reports it. A
 * provider with no measured models maps to null.
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

  const totals: Record<
    HomeProvider,
    { weight: number; success: number; latencyWeight: number; latency: number }
  > = {
    claude: { weight: 0, success: 0, latencyWeight: 0, latency: 0 },
    gpt: { weight: 0, success: 0, latencyWeight: 0, latency: 0 },
  }

  for (const model of perfModels) {
    const provider = providerOf(
      model.model_name,
      vendorByModel.get(model.model_name)
    )
    if (!provider || !Number.isFinite(model.success_rate)) continue
    const weight =
      model.request_count && model.request_count > 0 ? model.request_count : 1
    const bucket = totals[provider]
    bucket.weight += weight
    bucket.success += model.success_rate * weight
    if (Number.isFinite(model.avg_latency_ms) && model.avg_latency_ms > 0) {
      bucket.latencyWeight += weight
      bucket.latency += model.avg_latency_ms * weight
    }
  }

  const result = {} as Record<HomeProvider, ProviderHealth | null>
  for (const provider of Object.keys(totals) as HomeProvider[]) {
    const bucket = totals[provider]
    result[provider] =
      bucket.weight === 0
        ? null
        : {
            successRate: bucket.success / bucket.weight,
            avgLatencyMs:
              bucket.latencyWeight === 0
                ? Number.NaN
                : bucket.latency / bucket.latencyWeight,
          }
  }
  return result
}
