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

import { getPricing } from '@/features/pricing/api'
import { usePricingReference } from '@/features/pricing/hooks/use-pricing-data'
import { getGroupReferencePriceComparison } from '@/features/pricing/lib/reference-price'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useSystemConfigStore } from '@/stores/system-config-store'

/** Comparison feeds are optional and never gate API key selection or creation. */
export function useGroupPriceComparisons(
  ratios: Record<string, number | string>,
  enabled = true
) {
  const pricing = useQuery({
    queryKey: ['pricing'],
    queryFn: async () => requireServerSuccess(await getPricing()),
    staleTime: 5 * 60 * 1000,
    enabled,
    retry: false,
    meta: { errorToast: false, errorPage: false },
  })
  const reference = usePricingReference(enabled)
  const currency = useSystemConfigStore((state) => state.config.currency)
  return useMemo(
    () =>
      Object.fromEntries(
        Object.entries(ratios).map(([group, ratio]) => [
          group,
          typeof ratio === 'number'
            ? getGroupReferencePriceComparison(
                Array.isArray(pricing.data?.data) ? pricing.data.data : [],
                group,
                ratio,
                reference.data,
                currency
              )
            : null,
        ])
      ),
    [ratios, pricing.data, reference.data, currency]
  )
}
