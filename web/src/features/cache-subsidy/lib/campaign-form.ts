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
import type { TFunction } from 'i18next'
import { z } from 'zod'

import { parseQuotaFromDollars, quotaUnitsToEditableAmount } from '@/lib/format'

import {
  CAMPAIGN_VALIDATION,
  DEFAULT_CLAIM_PERIOD_DAYS,
  DEFAULT_MODEL_RULES,
  DEFAULT_SUBSIDY_PERCENT,
  DEFAULT_WINDOW_START,
  ERROR_MESSAGES,
} from '../constants'
import type { Campaign, CampaignPayload } from '../types'

// ============================================================================
// Form schema (call getCampaignFormSchema(t) in components for i18n messages)
// ============================================================================

export type CampaignFormValues = {
  name: string
  description: string
  window_start: Date | null
  window_end: Date | null
  model_rules: string[]
  include_cache_writes: boolean
  subsidy_percent: number
  claim_deadline: Date | null
  /** Per-user cap in the display currency; 0 means no cap. */
  per_user_cap_amount: number
  /** Minimum subsidy in the display currency; 0 means no minimum. */
  min_subsidy_amount: number
}

export function getCampaignFormSchema(t: TFunction) {
  const v = CAMPAIGN_VALIDATION
  const amount = z
    .number({ error: t(ERROR_MESSAGES.AMOUNT_NEGATIVE) })
    .min(0, t(ERROR_MESSAGES.AMOUNT_NEGATIVE))
  const percentMessage = t(ERROR_MESSAGES.PERCENT_RANGE, {
    min: v.PERCENT_MIN,
    max: v.PERCENT_MAX,
  })

  return z
    .object({
      name: z
        .string()
        .trim()
        .min(1, t(ERROR_MESSAGES.NAME_REQUIRED))
        .max(
          v.NAME_MAX_LENGTH,
          t(ERROR_MESSAGES.NAME_TOO_LONG, { max: v.NAME_MAX_LENGTH })
        ),
      description: z.string().max(
        v.DESCRIPTION_MAX_LENGTH,
        t(ERROR_MESSAGES.DESCRIPTION_TOO_LONG, {
          max: v.DESCRIPTION_MAX_LENGTH,
        })
      ),
      window_start: z
        .date()
        .nullable()
        .refine((value) => value !== null, {
          error: t(ERROR_MESSAGES.WINDOW_START_REQUIRED),
        }),
      window_end: z
        .date()
        .nullable()
        .refine((value) => value !== null, {
          error: t(ERROR_MESSAGES.WINDOW_END_REQUIRED),
        }),
      model_rules: z
        .array(z.string().trim().min(1))
        .min(1, t(ERROR_MESSAGES.MODEL_RULES_REQUIRED))
        .max(
          v.MODEL_RULES_MAX,
          t(ERROR_MESSAGES.MODEL_RULES_TOO_MANY, { max: v.MODEL_RULES_MAX })
        ),
      include_cache_writes: z.boolean(),
      subsidy_percent: z
        .number({ error: percentMessage })
        .min(v.PERCENT_MIN, percentMessage)
        .max(v.PERCENT_MAX, percentMessage),
      claim_deadline: z
        .date()
        .nullable()
        .refine((value) => value !== null, {
          error: t(ERROR_MESSAGES.CLAIM_DEADLINE_REQUIRED),
        }),
      per_user_cap_amount: amount,
      min_subsidy_amount: amount,
    })
    .superRefine((values, ctx) => {
      const start = values.window_start
      const end = values.window_end
      if (start && end && end.getTime() <= start.getTime()) {
        ctx.addIssue({
          code: 'custom',
          path: ['window_end'],
          message: t(ERROR_MESSAGES.WINDOW_END_BEFORE_START),
        })
      }
      const deadline = values.claim_deadline
      if (end && deadline && deadline.getTime() <= end.getTime()) {
        ctx.addIssue({
          code: 'custom',
          path: ['claim_deadline'],
          message: t(ERROR_MESSAGES.CLAIM_DEADLINE_BEFORE_WINDOW_END),
        })
      }
      if (
        values.per_user_cap_amount > 0 &&
        values.min_subsidy_amount > values.per_user_cap_amount
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['min_subsidy_amount'],
          message: t(ERROR_MESSAGES.MIN_ABOVE_CAP),
        })
      }
    })
}

// ============================================================================
// Defaults
// ============================================================================

/** A new campaign: the first campaign's window start, claims for 30 days. */
export function getCampaignFormDefaults(
  now: Date = new Date()
): CampaignFormValues {
  const claimDeadline = new Date(now)
  claimDeadline.setDate(claimDeadline.getDate() + DEFAULT_CLAIM_PERIOD_DAYS)

  return {
    name: '',
    description: '',
    window_start: new Date(
      DEFAULT_WINDOW_START.year,
      DEFAULT_WINDOW_START.monthIndex,
      DEFAULT_WINDOW_START.day,
      0,
      0,
      0
    ),
    window_end: null,
    model_rules: [...DEFAULT_MODEL_RULES],
    include_cache_writes: true,
    subsidy_percent: DEFAULT_SUBSIDY_PERCENT,
    claim_deadline: claimDeadline,
    per_user_cap_amount: 0,
    min_subsidy_amount: 0,
  }
}

// ============================================================================
// Transformations
// ============================================================================

function toUnixSeconds(date: Date | null): number {
  return date ? Math.floor(date.getTime() / 1000) : 0
}

function fromUnixSeconds(seconds: number): Date | null {
  return seconds > 0 ? new Date(seconds * 1000) : null
}

/** Form values to the create/update request body. */
export function transformFormToPayload(
  values: CampaignFormValues
): CampaignPayload {
  const rules: string[] = []
  for (const rule of values.model_rules) {
    const trimmed = rule.trim()
    if (trimmed && !rules.includes(trimmed)) rules.push(trimmed)
  }

  return {
    name: values.name.trim(),
    description: values.description.trim(),
    window_start: toUnixSeconds(values.window_start),
    window_end: toUnixSeconds(values.window_end),
    model_rules: rules,
    include_cache_writes: values.include_cache_writes,
    subsidy_percent: values.subsidy_percent,
    claim_deadline: toUnixSeconds(values.claim_deadline),
    per_user_cap_quota: parseQuotaFromDollars(values.per_user_cap_amount),
    min_subsidy_quota: parseQuotaFromDollars(values.min_subsidy_amount),
  }
}

/** A saved campaign as editable form values. */
export function transformCampaignToFormValues(
  campaign: Campaign
): CampaignFormValues {
  return {
    name: campaign.name,
    description: campaign.description ?? '',
    window_start: fromUnixSeconds(campaign.window_start),
    window_end: fromUnixSeconds(campaign.window_end),
    model_rules: [...(campaign.model_rules ?? [])],
    include_cache_writes: campaign.include_cache_writes,
    subsidy_percent: campaign.subsidy_percent,
    claim_deadline: fromUnixSeconds(campaign.claim_deadline),
    per_user_cap_amount: quotaUnitsToEditableAmount(
      campaign.per_user_cap_quota
    ),
    min_subsidy_amount: quotaUnitsToEditableAmount(campaign.min_subsidy_quota),
  }
}
