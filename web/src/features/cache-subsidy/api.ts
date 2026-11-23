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
import { captchaHeaders } from '@/lib/captcha'

import type {
  ApiResponse,
  CacheSubsidyClaimResult,
  Campaign,
  CampaignPayload,
  CampaignTransition,
  GetCampaignsParams,
  GetGrantsParams,
  Grant,
  PageData,
  UserCacheSubsidy,
} from './types'

const ADMIN_BASE = '/api/cache_subsidy/admin/campaigns'

// ============================================================================
// Campaign management (admin)
// ============================================================================

export async function getCampaigns(
  params: GetCampaignsParams
): Promise<ApiResponse<PageData<Campaign>>> {
  const res = await api.get(ADMIN_BASE, {
    params: {
      p: params.p,
      page_size: params.page_size,
      keyword: params.keyword ?? '',
    },
  })
  return res.data
}

export async function getCampaign(id: number): Promise<ApiResponse<Campaign>> {
  const res = await api.get(`${ADMIN_BASE}/${id}`)
  return res.data
}

export async function createCampaign(
  payload: CampaignPayload
): Promise<ApiResponse<Campaign>> {
  const res = await api.post(ADMIN_BASE, payload)
  return res.data
}

export async function updateCampaign(
  id: number,
  payload: CampaignPayload
): Promise<ApiResponse<Campaign>> {
  const res = await api.put(`${ADMIN_BASE}/${id}`, payload)
  return res.data
}

export async function deleteCampaign(id: number): Promise<ApiResponse<null>> {
  const res = await api.delete(`${ADMIN_BASE}/${id}`)
  return res.data
}

/** Start calculation, reset to draft, open claims or close a campaign. */
export async function transitionCampaign(
  id: number,
  transition: CampaignTransition
): Promise<ApiResponse<Campaign>> {
  const res = await api.post(`${ADMIN_BASE}/${id}/${transition}`)
  return res.data
}

export async function getCampaignGrants(
  id: number,
  params: GetGrantsParams
): Promise<ApiResponse<PageData<Grant>>> {
  const query: Record<string, string | number> = {
    p: params.p,
    page_size: params.page_size,
    keyword: params.keyword ?? '',
  }
  if (params.status) query.status = params.status
  const res = await api.get(`${ADMIN_BASE}/${id}/grants`, { params: query })
  return res.data
}

// ============================================================================
// User subsidies
// ============================================================================

export async function getUserCacheSubsidies(): Promise<
  ApiResponse<UserCacheSubsidy[]>
> {
  const res = await api.get('/api/user/cache_subsidy')
  return res.data
}

/** Claims one campaign's subsidy; the token, when given, is a GeeTest result. */
export async function claimCacheSubsidy(
  campaignId: number,
  captchaToken?: string
): Promise<ApiResponse<CacheSubsidyClaimResult>> {
  const res = await api.post(
    '/api/user/cache_subsidy/claim',
    { campaign_id: campaignId },
    { headers: captchaHeaders(captchaToken) }
  )
  return res.data
}
