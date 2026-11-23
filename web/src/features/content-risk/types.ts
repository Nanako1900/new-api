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
import type { StatusVariant } from '@/components/status-badge'

export type RiskLevel = 'normal' | 'watch' | 'restrict' | 'blocked'

/** Which score the page shows: the acting one or the shadow-mode one. */
export type RiskView = 'enforce' | 'shadow'

/**
 * One account of GET /api/content_safety/risk_profiles. Scores carry two
 * decimals and timestamps are Unix seconds. Levels stay plain strings because
 * a newer server may add values.
 */
export type RiskProfile = {
  user_id: number
  username: string
  score: number
  level: string
  shadow_score: number
  shadow_level: string
  would_block: boolean
  blocked: boolean
  blocked_at: number
  blocked_reason: string
  trusted: boolean
  unsafe_count: number
  controversial_count: number
  last_event_at: number
  updated_at: number
}

/** Query parameters of the list endpoint. */
export type RiskProfileFilters = {
  p: number
  page_size: number
  view: RiskView
  level?: RiskLevel
  trusted?: boolean
  user_id?: number
  username?: string
}

/** The `common.PageInfo` envelope returned in `data`. */
export type RiskProfilePage = {
  items: RiskProfile[]
  total: number
  page: number
  page_size: number
}

export type RiskLevelPresentation = {
  labelKey: string
  variant: StatusVariant
}

/** A row action waiting for confirmation. */
export type RiskProfileAction = {
  kind: 'reset' | 'trust' | 'untrust'
  profile: RiskProfile
}
