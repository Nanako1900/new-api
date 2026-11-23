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
import type { StatusBadgeProps } from '@/components/status-badge'

import type {
  CampaignStatus,
  CampaignTransition,
  GrantStatus,
  SkipReason,
} from './types'

// ============================================================================
// Statuses (labelKey values are i18n keys; render with t(config.labelKey))
// ============================================================================

type StatusConfig = Pick<StatusBadgeProps, 'variant'> & { labelKey: string }

export const CAMPAIGN_STATUSES: Record<CampaignStatus, StatusConfig> = {
  draft: { labelKey: 'Draft', variant: 'neutral' },
  queued: { labelKey: 'Queued', variant: 'info' },
  calculating: { labelKey: 'Calculating', variant: 'blue' },
  calculated: { labelKey: 'Ready to open', variant: 'purple' },
  open: { labelKey: 'Claims open', variant: 'success' },
  closed: { labelKey: 'Closed', variant: 'grey' },
}

export const GRANT_STATUSES: Record<GrantStatus, StatusConfig> = {
  pending: { labelKey: 'Unclaimed', variant: 'warning' },
  claimed: { labelKey: 'Claimed', variant: 'success' },
}

export const GRANT_STATUS_VALUES = ['pending', 'claimed'] as const

/** Statuses during which the server is still scanning consume logs. */
export const COMPUTING_STATUSES: readonly CampaignStatus[] = [
  'queued',
  'calculating',
]

/** Statuses whose campaign has precomputed grants to show. */
export const STATUSES_WITH_GRANTS: readonly CampaignStatus[] = [
  'calculated',
  'open',
  'closed',
]

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  subscription: 'Paid by subscription',
  per_request: 'Per-request pricing',
  unsupported_expression: 'Unsupported pricing expression',
  model_mismatch: 'Model not in the rules',
  no_cache: 'No cache usage',
}

/** How often a campaign is polled while it is queued or calculating. */
export const CAMPAIGN_POLL_INTERVAL_MS = 5000

// ============================================================================
// Form defaults and validation
// ============================================================================

export const DEFAULT_MODEL_RULES = ['claude*', 'gpt*']
export const DEFAULT_SUBSIDY_PERCENT = 75
/** The first campaign starts at 2026-11-13 00:00 in the administrator's time zone. */
export const DEFAULT_WINDOW_START = { year: 2026, monthIndex: 10, day: 13 }
export const DEFAULT_CLAIM_PERIOD_DAYS = 30

export const CAMPAIGN_VALIDATION = {
  NAME_MAX_LENGTH: 64,
  DESCRIPTION_MAX_LENGTH: 500,
  MODEL_RULES_MAX: 50,
  PERCENT_MIN: 0,
  PERCENT_MAX: 100,
} as const

// ============================================================================
// Confirmation copy for status changes and deletion (i18n keys)
// ============================================================================

type ConfirmCopy = {
  title: string
  description: string
  confirm: string
  success: string
  destructive?: boolean
}

export const CAMPAIGN_ACTION_COPY: Record<
  CampaignTransition | 'delete',
  ConfirmCopy
> = {
  calculate: {
    title: 'Start calculation?',
    description:
      'The server scans the consume logs in the campaign window and works out each user’s subsidy. Rules stay locked until you reset the campaign to draft.',
    confirm: 'Start calculation',
    success: 'Calculation started',
  },
  reset: {
    title: 'Reset to draft?',
    description:
      'The calculated grants are discarded so you can change the rules and calculate again.',
    confirm: 'Reset to draft',
    success: 'Campaign reset to draft',
  },
  open: {
    title: 'Open claims?',
    description:
      '{{users}} users can claim {{amount}} in total from their dashboard until {{deadline}}. Rules can no longer be changed.',
    confirm: 'Open claims',
    success: 'Claims are open',
  },
  close: {
    title: 'Close claims?',
    description:
      'Users can no longer claim. Subsidies already claimed stay in their wallets.',
    confirm: 'Close claims',
    success: 'Claims closed',
    destructive: true,
  },
  delete: {
    title: 'Delete campaign?',
    description:
      'This permanently deletes “{{name}}” and its calculated grants. This action cannot be undone.',
    confirm: 'Delete',
    success: 'Campaign deleted',
    destructive: true,
  },
}

// ============================================================================
// Messages (i18n keys; display with t(...))
// ============================================================================

export const ERROR_MESSAGES = {
  LOAD_FAILED: 'Failed to load cache subsidy campaigns',
  LOAD_CAMPAIGN_FAILED: 'Failed to load the campaign',
  LOAD_GRANTS_FAILED: 'Failed to load grants',
  SAVE_FAILED: 'Failed to save the campaign',
  ACTION_FAILED: 'The campaign could not be updated',
  CLAIM_FAILED: 'Cache subsidy claim failed, please try again later',
  NAME_REQUIRED: 'Name is required',
  NAME_TOO_LONG: 'Name must be at most {{max}} characters',
  DESCRIPTION_TOO_LONG: 'Description must be at most {{max}} characters',
  WINDOW_START_REQUIRED: 'Select when the window starts',
  WINDOW_END_REQUIRED: 'Select when the window ends',
  WINDOW_END_BEFORE_START: 'The window must end after it starts',
  CLAIM_DEADLINE_REQUIRED: 'Select a claim deadline',
  CLAIM_DEADLINE_BEFORE_WINDOW_END:
    'The claim deadline must be after the window ends',
  MODEL_RULES_REQUIRED: 'Add at least one model rule',
  MODEL_RULES_TOO_MANY: 'Use at most {{max}} model rules',
  PERCENT_RANGE: 'Enter a percentage between {{min}} and {{max}}',
  AMOUNT_NEGATIVE: 'Enter 0 or a positive amount',
  MIN_ABOVE_CAP: 'The minimum cannot be greater than the per-user cap',
} as const

export const SUCCESS_MESSAGES = {
  CAMPAIGN_CREATED: 'Campaign created',
  CAMPAIGN_UPDATED: 'Campaign updated',
  CLAIMED: 'Cache subsidy received {{quota}}',
} as const
