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

// ============================================================================
// Campaigns (admin)
// ============================================================================

export type CampaignStatus =
  | 'draft'
  | 'queued'
  | 'calculating'
  | 'calculated'
  | 'open'
  | 'closed'

export type SkipReason =
  | 'subscription'
  | 'per_request'
  | 'unsupported_expression'
  | 'model_mismatch'
  | 'no_cache'

/** A cache subsidy campaign. Quotas are quota units, times unix seconds. */
export interface Campaign {
  id: number
  name: string
  description: string
  status: CampaignStatus
  window_start: number
  window_end: number
  model_rules: string[]
  include_cache_writes: boolean
  subsidy_percent: number
  claim_deadline: number
  /** 0 means no cap. */
  per_user_cap_quota: number
  /** 0 means no minimum. */
  min_subsidy_quota: number
  scanned_logs: number
  matched_logs: number
  skipped_logs: number
  /** Skipped log counts keyed by {@link SkipReason}; future keys may appear. */
  skip_reasons: Record<string, number>
  /** Calculation progress, 0-100. */
  progress: number
  eligible_users: number
  total_cache_quota: number
  total_subsidy_quota: number
  claimed_users: number
  claimed_quota: number
  calculated_at: number
  opened_at: number
  closed_at: number
  created_at: number
  updated_at: number
}

/** Body of `POST /campaigns` and `PUT /campaigns/:id`. */
export interface CampaignPayload {
  name: string
  description: string
  window_start: number
  window_end: number
  model_rules: string[]
  include_cache_writes: boolean
  subsidy_percent: number
  claim_deadline: number
  per_user_cap_quota: number
  min_subsidy_quota: number
}

/** Status changes an administrator can request with `POST /campaigns/:id/<action>`. */
export type CampaignTransition = 'calculate' | 'reset' | 'open' | 'close'

/** Every action a campaign row can offer. */
export type CampaignAction =
  | 'edit'
  | 'details'
  | 'grants'
  | 'delete'
  | CampaignTransition

export type GrantStatus = 'pending' | 'claimed'

/** One user's precomputed subsidy in a campaign. */
export interface Grant {
  id: number
  user_id: number
  username: string
  log_count: number
  cache_read_tokens: number
  cache_write_tokens: number
  cache_quota: number
  subsidy_quota: number
  status: GrantStatus
  claimed_at: number
}

// ============================================================================
// API envelopes
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  code?: string
  data?: T
}

export interface PageData<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface GetCampaignsParams {
  p: number
  page_size: number
  keyword?: string
}

export interface GetGrantsParams {
  p: number
  page_size: number
  keyword?: string
  status?: GrantStatus | ''
}

// ============================================================================
// User subsidies (dashboard)
// ============================================================================

export interface UserCacheSubsidy {
  campaign: Pick<
    Campaign,
    | 'id'
    | 'name'
    | 'description'
    | 'subsidy_percent'
    | 'include_cache_writes'
    | 'window_start'
    | 'window_end'
    | 'claim_deadline'
  >
  grant: Pick<
    Grant,
    | 'log_count'
    | 'cache_read_tokens'
    | 'cache_write_tokens'
    | 'cache_quota'
    | 'subsidy_quota'
    | 'status'
    | 'claimed_at'
  >
}

export interface CacheSubsidyClaimResult {
  quota: number
}

// ============================================================================
// Dialogs
// ============================================================================

export type CampaignsDialogType = 'create' | 'update' | 'details' | 'grants'
