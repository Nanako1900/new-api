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
import { useQueries } from '@tanstack/react-query'

import { getPerfMetrics } from '@/features/performance-metrics/api'
import type { PerformanceGroup } from '@/features/performance-metrics/types'
import { requireServerSuccess } from '@/lib/server-error-message'

import type { MeowChannelPerf } from '../lib/meow-catalog'

// The details drawer reads the same key and window, so both share the cache.
const PERF_WINDOW_HOURS = 24

/** Last-24h metrics for each model, indexed by model name and group. */
export function useMeowChannelPerf(modelNames: string[]): MeowChannelPerf {
  return useQueries({
    queries: modelNames.map((modelName) => ({
      queryKey: ['perf-metrics', modelName],
      queryFn: async () =>
        requireServerSuccess(
          await getPerfMetrics(modelName, PERF_WINDOW_HOURS)
        ),
      staleTime: 60 * 1000,
      retry: false,
      meta: { errorToast: false },
    })),
    combine: (results) => {
      const byModel = new Map<string, Map<string, PerformanceGroup>>()
      let windowEnd: number | undefined
      results.forEach((result, index) => {
        const data = result.data?.data
        if (!data) return
        // Queries refresh at different times; keep the newest window end.
        if (data.window_end !== undefined) {
          windowEnd = Math.max(windowEnd ?? data.window_end, data.window_end)
        }
        byModel.set(
          modelNames[index],
          new Map((data.groups ?? []).map((group) => [group.group, group]))
        )
      })
      return { byModel, windowEnd }
    },
  })
}
