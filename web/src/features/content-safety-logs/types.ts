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

export type ContentSafetyDecision =
  | 'keyword_blocked'
  | 'review_passed'
  | 'review_rejected'
  | 'review_failed'

export type ContentSafetyFailureReason =
  | 'timeout'
  | 'no_channel'
  | 'unparseable'
  | 'too_many_windows'
  | 'rate_limited'
  | 'upstream_error'
  | 'client_canceled'

/**
 * One record of GET /api/content_safety/logs. `hit_words` and `snippets` are
 * JSON-encoded string arrays. `decision` and `failure_reason` stay plain
 * strings because a newer server may add values. `id` is always 0 on a
 * ClickHouse log store, so rows are keyed by `event_id`.
 */
export type ContentSafetyLog = {
  id: number
  event_id: string
  created_at: number
  request_id: string
  user_id: number
  username: string
  token_id: number
  token_name: string
  group: string
  model: string
  request_path: string
  decision: string
  failure_reason: string
  hit_words: string
  snippets: string
  ai_category: string
  ai_reason: string
  review_channel_id: number
  review_model: string
  latency_ms: number
  review_tokens: number
  cache_hit: boolean
}

/** Query parameters of the log endpoint; timestamps are Unix seconds. */
export type ContentSafetyLogFilters = {
  p: number
  page_size: number
  user_id?: string
  decision?: ContentSafetyDecision
  model?: string
  request_id?: string
  start_timestamp?: number
  end_timestamp?: number
}

/** The `common.PageInfo` envelope returned in `data`. */
export type ContentSafetyLogPage = {
  items: ContentSafetyLog[]
  total: number
  page: number
  page_size: number
}

export type DecisionPresentation = {
  labelKey: string
  variant: StatusVariant
}

/** Inline validation messages of the filter inputs; a field is set while invalid. */
export type ContentSafetyLogFieldErrors = {
  user_id?: string
  request_id?: string
  model?: string
}
