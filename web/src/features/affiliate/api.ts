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
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import type {
  AffiliateAction,
  AffiliateEntry,
  AffiliatePage,
  AffiliateSummary,
  Invitee,
} from './types'

type Response<T> = { success: boolean; message: string; data: T }

export async function getAffiliate(userId?: number): Promise<AffiliateSummary> {
  const path =
    userId === undefined
      ? '/api/user/affiliate'
      : `/api/user/${userId}/affiliate`
  const response = await api.get<Response<AffiliateSummary>>(path)
  return requireServerSuccess(response.data).data
}

export async function getAffiliateHistory(
  userId: number | undefined,
  page: number
): Promise<AffiliatePage<AffiliateEntry>> {
  const path =
    userId === undefined
      ? '/api/user/affiliate/history'
      : `/api/user/${userId}/affiliate/history`
  const response = await api.get<Response<AffiliatePage<AffiliateEntry>>>(
    path,
    { params: { p: page, page_size: 10 } }
  )
  return requireServerSuccess(response.data).data
}

export async function getInvitees(
  userId: number,
  page: number
): Promise<AffiliatePage<Invitee>> {
  const response = await api.get<Response<AffiliatePage<Invitee>>>(
    `/api/user/${userId}/affiliate/invitees`,
    { params: { p: page, page_size: 10 } }
  )
  return requireServerSuccess(response.data).data
}

export async function manageAffiliate(
  action: AffiliateAction,
  proofToken: string
): Promise<void> {
  const response = await api.post<Response<null>>(
    `/api/user/${action.user_id}/affiliate`,
    action,
    {
      headers: { 'X-Security-Proof': proofToken },
      singleUseAuthorization: true,
    }
  )
  requireServerSuccess(response.data)
}
