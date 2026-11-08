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

import type { ContentSafetySettings, FilteringSettings } from './defaults'

export const CONTENT_SAFETY_OPTION_PREFIX = 'content_safety_setting.'

// Written together with any other content safety option so the backend
// validates the review group.
export const REVIEW_GUARD_OPTION_KEYS = [
  `${CONTENT_SAFETY_OPTION_PREFIX}review_enabled`,
  `${CONTENT_SAFETY_OPTION_PREFIX}review_group`,
] as const

// Inclusive bounds checked by the backend request policy validation.
export const CONTENT_SAFETY_INT_LIMITS = {
  review_timeout_seconds: { min: 1, max: 60 },
  review_max_concurrency: { min: 1, max: 256 },
  review_rate_limit_per_minute: { min: 1, max: 10000 },
  window_chars: { min: 50, max: 2000 },
  max_windows: { min: 1, max: 100 },
  cache_ttl_seconds: { min: 0, max: 604800 },
  log_retention_days: { min: 1, max: 3650 },
} as const

export type ContentSafetyIntField = keyof typeof CONTENT_SAFETY_INT_LIMITS

export type RequestChecksSettings = FilteringSettings & ContentSafetySettings

export function createRequestChecksSchema(t: TFunction) {
  const integerWithin = (field: ContentSafetyIntField) => {
    const limits = CONTENT_SAFETY_INT_LIMITS[field]
    const message = t('Enter an integer from {{min}} to {{max}}', {
      min: limits.min,
      max: limits.max,
    })
    return z
      .number()
      .int(message)
      .min(limits.min, message)
      .max(limits.max, message)
  }
  return z.object({
    CheckSensitiveEnabled: z.boolean(),
    CheckSensitiveOnPromptEnabled: z.boolean(),
    SensitiveWords: z.string(),
    content_safety_setting: z
      .object({
        review_enabled: z.boolean(),
        review_words: z.string(),
        review_model: z.string(),
        review_group: z.string(),
        review_prompt: z.string(),
        review_timeout_seconds: integerWithin('review_timeout_seconds'),
        review_max_concurrency: integerWithin('review_max_concurrency'),
        review_rate_limit_per_minute: integerWithin(
          'review_rate_limit_per_minute'
        ),
        window_chars: integerWithin('window_chars'),
        max_windows: integerWithin('max_windows'),
        cache_ttl_seconds: integerWithin('cache_ttl_seconds'),
        log_retention_days: integerWithin('log_retention_days'),
      })
      .superRefine((value, context) => {
        // The backend refuses to enable AI review without these values.
        if (!value.review_enabled) return
        if (!value.review_words.trim()) {
          context.addIssue({
            code: 'custom',
            path: ['review_words'],
            message: t('Enter at least one review word'),
          })
        }
        if (!value.review_model.trim()) {
          context.addIssue({
            code: 'custom',
            path: ['review_model'],
            message: t('Select a review model'),
          })
        }
        if (!value.review_group.trim()) {
          context.addIssue({
            code: 'custom',
            path: ['review_group'],
            message: t('Select a review group'),
          })
        }
      }),
  })
}

export type RequestChecksFormValues = z.infer<
  ReturnType<typeof createRequestChecksSchema>
>

export function requestChecksFormValues(
  settings: RequestChecksSettings
): RequestChecksFormValues {
  return {
    CheckSensitiveEnabled: settings.CheckSensitiveEnabled,
    CheckSensitiveOnPromptEnabled: settings.CheckSensitiveOnPromptEnabled,
    SensitiveWords: settings.SensitiveWords,
    content_safety_setting: {
      review_enabled: settings['content_safety_setting.review_enabled'],
      review_words: settings['content_safety_setting.review_words'],
      review_model: settings['content_safety_setting.review_model'],
      review_group: settings['content_safety_setting.review_group'],
      review_prompt: settings['content_safety_setting.review_prompt'],
      review_timeout_seconds:
        settings['content_safety_setting.review_timeout_seconds'],
      review_max_concurrency:
        settings['content_safety_setting.review_max_concurrency'],
      review_rate_limit_per_minute:
        settings['content_safety_setting.review_rate_limit_per_minute'],
      window_chars: settings['content_safety_setting.window_chars'],
      max_windows: settings['content_safety_setting.max_windows'],
      cache_ttl_seconds: settings['content_safety_setting.cache_ttl_seconds'],
      log_retention_days: settings['content_safety_setting.log_retention_days'],
    },
  }
}

/** Flattens form values into the request policy option map. */
export function requestChecksOptions(
  values: RequestChecksFormValues
): Record<string, string> {
  const review = {
    ...values.content_safety_setting,
    review_model: values.content_safety_setting.review_model.trim(),
    review_group: values.content_safety_setting.review_group.trim(),
  }
  return {
    CheckSensitiveEnabled: String(values.CheckSensitiveEnabled),
    CheckSensitiveOnPromptEnabled: String(values.CheckSensitiveOnPromptEnabled),
    SensitiveWords: values.SensitiveWords,
    ...Object.fromEntries(
      Object.entries(review).map(([key, value]) => [
        `${CONTENT_SAFETY_OPTION_PREFIX}${key}`,
        String(value),
      ])
    ),
  }
}
