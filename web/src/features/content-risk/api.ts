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
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { t } from 'i18next'

import type { ApiResponse } from '@/features/profile/types'
import { api } from '@/lib/api'
import { createServerError } from '@/lib/server-error-message'

import { RISK_PROFILES_QUERY_KEY } from './constants'
import type { RiskProfileFilters, RiskProfilePage } from './types'

export async function getRiskProfiles(
  params: RiskProfileFilters
): Promise<RiskProfilePage> {
  const response = await api.get<ApiResponse<RiskProfilePage>>(
    '/api/content_safety/risk_profiles',
    { params }
  )
  if (!response.data.success || !response.data.data) {
    throw createServerError(response.data, t('Failed to load risk profiles'))
  }
  return response.data.data
}

export function useRiskProfiles(params: RiskProfileFilters) {
  return useQuery({
    queryKey: [RISK_PROFILES_QUERY_KEY, params],
    queryFn: () => getRiskProfiles(params),
    placeholderData: keepPreviousData,
    retry: false,
  })
}

/** Sets the score to 0 and lifts a block; the verdict counts are kept. */
export async function resetRiskProfile(userId: number): Promise<void> {
  const response = await api.post<ApiResponse>(
    `/api/content_safety/risk_profiles/${userId}/reset`
  )
  if (!response.data.success) {
    throw createServerError(response.data, t('Failed to reset the risk score'))
  }
}

export async function setRiskProfileTrust(
  userId: number,
  trusted: boolean
): Promise<void> {
  const response = await api.post<ApiResponse>(
    `/api/content_safety/risk_profiles/${userId}/trust`,
    { trusted }
  )
  if (!response.data.success) {
    throw createServerError(
      response.data,
      t('Failed to change whether the account is trusted')
    )
  }
}
