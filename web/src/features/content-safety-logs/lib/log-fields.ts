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
import {
  DECISION_PRESENTATION,
  FAILURE_REASON_LABEL_KEYS,
  MODE_LABEL_KEYS,
} from '../constants'
import type {
  ContentSafetyDecision,
  ContentSafetyFailureReason,
  ContentSafetyMode,
  ContentSafetyStatsCount,
  DecisionPresentation,
} from '../types'

/**
 * Reads a JSON-encoded string array stored in a log column (`hit_words`,
 * `snippets`). Text that is not a JSON array is returned as the only entry,
 * so a damaged record still shows what was stored; JSON `null` is an empty
 * list. Empty, whitespace-only and non-string entries are dropped. Repeated
 * entries are kept unless `unique` is set, which hit words use and snippets
 * do not.
 */
export function parseStringList(
  raw: string | null | undefined,
  options?: { unique?: boolean }
): string[] {
  const text = (raw ?? '').trim()
  if (!text) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return [text]
  }
  if (parsed === null) return []
  if (!Array.isArray(parsed)) return [text]
  const entries = parsed.filter(
    (item): item is string => typeof item === 'string' && item.trim() !== ''
  )
  return options?.unique ? [...new Set(entries)] : entries
}

export function isContentSafetyDecision(
  value: string
): value is ContentSafetyDecision {
  return Object.hasOwn(DECISION_PRESENTATION, value)
}

/** Badge label key and color of a decision; unknown values keep their text. */
export function decisionPresentation(decision: string): DecisionPresentation {
  if (isContentSafetyDecision(decision)) {
    return DECISION_PRESENTATION[decision]
  }
  return { labelKey: decision, variant: 'neutral' }
}

export function isContentSafetyFailureReason(
  value: string
): value is ContentSafetyFailureReason {
  return Object.hasOwn(FAILURE_REASON_LABEL_KEYS, value)
}

/** Label key of a failure reason; unknown values keep their text. */
export function failureReasonLabelKey(reason: string): string {
  if (isContentSafetyFailureReason(reason)) {
    return FAILURE_REASON_LABEL_KEYS[reason]
  }
  return reason
}

export function isContentSafetyMode(value: string): value is ContentSafetyMode {
  return Object.hasOwn(MODE_LABEL_KEYS, value)
}

/** Label key of a review mode; empty (old keyword rows) is null, unknown keeps its text. */
export function modeLabelKey(mode: string): string | null {
  if (!mode) return null
  if (isContentSafetyMode(mode)) return MODE_LABEL_KEYS[mode]
  return mode
}

/** Keyword rows are not AI reviews; every other decision is one. */
export function isReviewedDecision(decision: string): boolean {
  return decision !== 'keyword_blocked'
}

export type ContentSafetyStatsSummary = {
  reviews: number
  flaggedOrRejected: number
  controversial: number
  failed: number
  refused: number
}

/** Adds the weighted totals of the stats rows into the figures of the strip. */
export function summarizeStatsCounts(
  counts: readonly ContentSafetyStatsCount[]
): ContentSafetyStatsSummary {
  const summary: ContentSafetyStatsSummary = {
    reviews: 0,
    flaggedOrRejected: 0,
    controversial: 0,
    failed: 0,
    refused: 0,
  }
  for (const row of counts) {
    if (row.failure_reason === 'refused') summary.refused += row.total
    if (!row.decision.startsWith('review_')) continue
    summary.reviews += row.total
    if (row.decision === 'review_flagged') summary.flaggedOrRejected += row.total
    if (row.decision === 'review_rejected') summary.flaggedOrRejected += row.total
    if (row.decision === 'review_controversial') summary.controversial += row.total
    if (row.decision === 'review_failed') summary.failed += row.total
  }
  return summary
}
