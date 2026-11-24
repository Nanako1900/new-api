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

import type { ContentRiskSettings } from './defaults'
import {
  CONTENT_SAFETY_OPTION_PREFIX,
  contentSafetyIntegerSchema,
} from './request-checks-form'

// The fixed verdict categories of the reviewer, in display order.
export const RISK_CATEGORIES = [
  'sexual_minors',
  'weapons',
  'terrorism',
  'self_harm',
  'cyber_attack',
  'fraud',
  'sexual',
  'other',
] as const

export type RiskCategory = (typeof RISK_CATEGORIES)[number]

// Values are i18n keys; render them with t(key).
export const RISK_CATEGORY_LABEL_KEYS: Record<RiskCategory, string> = {
  sexual_minors: 'Sexual content involving minors',
  weapons: 'Weapons',
  terrorism: 'Terrorism',
  self_harm: 'Self-harm',
  cyber_attack: 'Cyber attacks',
  fraud: 'Fraud',
  sexual: 'Sexual content',
  other: 'Other',
}

export function createRiskSchema(t: TFunction, locale: string | undefined) {
  return z.object({
    content_safety_setting: z
      .object({
        risk_half_life_hours: contentSafetyIntegerSchema(
          t,
          locale,
          'risk_half_life_hours'
        ),
        risk_points_unsafe: contentSafetyIntegerSchema(
          t,
          locale,
          'risk_points_unsafe'
        ),
        risk_points_controversial: contentSafetyIntegerSchema(
          t,
          locale,
          'risk_points_controversial'
        ),
        risk_zero_tolerance_categories: z.string(),
        risk_watch_threshold: contentSafetyIntegerSchema(
          t,
          locale,
          'risk_watch_threshold'
        ),
        risk_restrict_threshold: contentSafetyIntegerSchema(
          t,
          locale,
          'risk_restrict_threshold'
        ),
        risk_block_threshold: contentSafetyIntegerSchema(
          t,
          locale,
          'risk_block_threshold'
        ),
        risk_restrict_rpm: contentSafetyIntegerSchema(
          t,
          locale,
          'risk_restrict_rpm'
        ),
        risk_notify_enabled: z.boolean(),
      })
      .superRefine((value, context) => {
        // The backend requires watch < restrict < block.
        if (value.risk_restrict_threshold <= value.risk_watch_threshold) {
          context.addIssue({
            code: 'custom',
            path: ['risk_restrict_threshold'],
            message: t('Must be greater than the watch threshold'),
          })
        }
        if (value.risk_block_threshold <= value.risk_restrict_threshold) {
          context.addIssue({
            code: 'custom',
            path: ['risk_block_threshold'],
            message: t('Must be greater than the restrict threshold'),
          })
        }
      }),
  })
}

export type RiskFormValues = z.infer<ReturnType<typeof createRiskSchema>>

export function riskFormValues(settings: ContentRiskSettings): RiskFormValues {
  return {
    content_safety_setting: {
      risk_half_life_hours:
        settings['content_safety_setting.risk_half_life_hours'],
      risk_points_unsafe: settings['content_safety_setting.risk_points_unsafe'],
      risk_points_controversial:
        settings['content_safety_setting.risk_points_controversial'],
      risk_zero_tolerance_categories:
        settings['content_safety_setting.risk_zero_tolerance_categories'],
      risk_watch_threshold:
        settings['content_safety_setting.risk_watch_threshold'],
      risk_restrict_threshold:
        settings['content_safety_setting.risk_restrict_threshold'],
      risk_block_threshold:
        settings['content_safety_setting.risk_block_threshold'],
      risk_restrict_rpm: settings['content_safety_setting.risk_restrict_rpm'],
      risk_notify_enabled:
        settings['content_safety_setting.risk_notify_enabled'],
    },
  }
}

/** Flattens form values into the request policy option map. */
export function riskOptions(values: RiskFormValues): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values.content_safety_setting).map(([key, value]) => [
      `${CONTENT_SAFETY_OPTION_PREFIX}${key}`,
      String(value),
    ])
  )
}
