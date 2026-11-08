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
import type {
  ContentSafetyDecision,
  ContentSafetyFailureReason,
  DecisionPresentation,
} from './types'

export const CONTENT_SAFETY_LOG_PAGE_SIZE = 20

// Order of the decisions in the filter.
export const CONTENT_SAFETY_DECISIONS: readonly ContentSafetyDecision[] = [
  'keyword_blocked',
  'review_passed',
  'review_rejected',
  'review_failed',
]

// labelKey values are i18n keys; render them with t(labelKey).
export const DECISION_PRESENTATION: Record<
  ContentSafetyDecision,
  DecisionPresentation
> = {
  keyword_blocked: { labelKey: 'Blocked by keyword', variant: 'danger' },
  review_passed: { labelKey: 'Review passed', variant: 'success' },
  review_rejected: { labelKey: 'Review rejected', variant: 'danger' },
  review_failed: { labelKey: 'Review failed', variant: 'warning' },
}

export const FAILURE_REASON_LABEL_KEYS: Record<
  ContentSafetyFailureReason,
  string
> = {
  timeout: 'Review timed out',
  no_channel: 'No review channel available',
  unparseable: 'Unreadable review answer',
  too_many_windows: 'Too many review windows',
  rate_limited: 'Review rate limit reached',
  upstream_error: 'Review upstream error',
  client_canceled: 'Client canceled',
}
