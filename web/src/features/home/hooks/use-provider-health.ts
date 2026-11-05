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
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { getPerfMetricsSummary } from '@/features/performance-metrics/api'
import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'
import { requireServerSuccess } from '@/lib/server-error-message'

import { summarizeProviderHealth } from '../lib/provider-health'

/** The window, in hours, the home page reports health for. */
export const HOME_HEALTH_HOURS = 24

/**
 * Live Claude / GPT health for the home page, from the public performance
 * summary. Failures stay silent: the status strip simply hides.
 */
export function useProviderHealth() {
  const { models } = usePricingData()
  const query = useQuery({
    queryKey: ['perf-metrics-summary', HOME_HEALTH_HOURS, 'home'],
    queryFn: async () =>
      requireServerSuccess(await getPerfMetricsSummary(HOME_HEALTH_HOURS)),
    staleTime: 60 * 1000,
    retry: false,
    meta: { errorToast: false },
  })

  const health = useMemo(
    () => summarizeProviderHealth(query.data?.data?.models ?? [], models),
    [query.data, models]
  )

  return { health, isLoading: query.isLoading, isError: query.isError }
}
