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
import { queryOptions } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import { ALERT_HISTORY_QUERY_KEY, CONSOLE_ALERTS_QUERY_KEY } from './constants'
import type { GetActiveAlertsResponse, GetAlertHistoryResponse } from './types'

const ALERTS_STALE_TIME_MS = 60 * 1000
const ALERTS_REFETCH_INTERVAL_MS = 5 * 60 * 1000
const ALERT_HISTORY_STALE_TIME_MS = 5 * 60 * 1000

export async function getActiveAlerts(): Promise<GetActiveAlertsResponse> {
  const res = await api.get<GetActiveAlertsResponse>('/api/alerts')
  return res.data
}

/** Alerts that were live before and are not live now, newest first. */
export async function getAlertHistory(): Promise<GetAlertHistoryResponse> {
  const res = await api.get<GetAlertHistoryResponse>('/api/alerts/history')
  return res.data
}

/** Root only: removes a deleted alert from every user's history. */
export async function deleteAlertHistoryEntry(
  id: number
): Promise<{ success: boolean; message?: string }> {
  const res = await api.delete(`/api/option/alert_history/${id}`)
  return res.data
}

/** Past alerts for the header bell; signed-in users only, like the alerts. */
export const alertHistoryQueryOptions = queryOptions({
  queryKey: ALERT_HISTORY_QUERY_KEY,
  queryFn: async () => requireServerSuccess(await getAlertHistory()).data ?? [],
  staleTime: ALERT_HISTORY_STALE_TIME_MS,
  meta: { errorToast: false },
})

/**
 * The live alert list shared by the console banner and the header bell, so
 * both read one cache entry. Failed fetches never toast; a final HTTP 500
 * still goes through the app's shared 500 handling, like every console query.
 * `/api/alerts` needs a signed-in user: callers outside the console must
 * disable the query for visitors.
 */
export const activeAlertsQueryOptions = queryOptions({
  queryKey: CONSOLE_ALERTS_QUERY_KEY,
  queryFn: async () => requireServerSuccess(await getActiveAlerts()).data ?? [],
  staleTime: ALERTS_STALE_TIME_MS,
  refetchInterval: ALERTS_REFETCH_INTERVAL_MS,
  refetchOnWindowFocus: true,
  meta: { errorToast: false },
})
