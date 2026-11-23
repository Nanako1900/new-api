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
import { useTranslation } from 'react-i18next'

import { channelUsageDescription } from '@/features/pricing/lib/meow-catalog'
import { getUserGroups } from '@/lib/api'
import {
  requireServerSuccess,
  translateServerText,
} from '@/lib/server-error-message'

import type { ApiKeyGroupOption } from './components/api-key-group-combobox'
import { useGroupPriceComparisons } from './use-group-price-comparisons'

/** Groups the user can give an API key, as picker options with price notes. */
export function useApiKeyGroupOptions(enabled = true) {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['user-groups'],
    queryFn: async () => requireServerSuccess(await getUserGroups()),
    enabled,
    staleTime: 0,
  })

  const groupRatios = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(query.data?.data ?? {}).map(([group, info]) => [
          group,
          info.ratio,
        ])
      ),
    [query.data]
  )
  const comparisons = useGroupPriceComparisons(groupRatios, enabled)
  const groups = useMemo<ApiKeyGroupOption[]>(
    () =>
      Object.entries(query.data?.data || {}).map(([key, info]) => ({
        value: key,
        label: key,
        desc: info.desc
          ? channelUsageDescription({
              description: translateServerText(t, info.desc),
              ratio: typeof info.ratio === 'number' ? info.ratio : 1,
            })
          : key,
        ratio: info.ratio,
        comparison: comparisons[key],
      })),
    [query.data, comparisons, t]
  )

  return { groups, isFetched: query.isFetched, isFetching: query.isFetching }
}
