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
import { describe, expect, it } from 'vitest'

import {
  decisionPresentation,
  failureReasonLabelKey,
  isReviewedDecision,
  modeLabelKey,
  parseStringList,
  summarizeStatsCounts,
} from '../lib/log-fields'

describe('parseStringList', () => {
  it.each([
    ['a JSON string array', '["knife","gun"]', ['knife', 'gun']],
    ['an empty value', '', []],
    ['an empty JSON array', '[]', []],
    [
      'an array with empty, whitespace-only and non-string entries',
      '["knife",1," ",null,"","gun"]',
      ['knife', 'gun'],
    ],
    ['JSON null', 'null', []],
    ['invalid JSON', '["knife"', ['["knife"']],
    ['JSON that is not an array', '{"word":"knife"}', ['{"word":"knife"}']],
  ])('turns %s into the stored entries', (_case, raw, expected) => {
    expect(parseStringList(raw)).toEqual(expected)
  })
})

describe('parseStringList repeated entries', () => {
  const raw = '["knife","knife","gun"]'

  it('keeps repeated entries by default so every snippet shows', () => {
    expect(parseStringList(raw)).toEqual(['knife', 'knife', 'gun'])
  })

  it('drops repeated entries when unique is requested for hit words', () => {
    expect(parseStringList(raw, { unique: true })).toEqual(['knife', 'gun'])
  })
})

describe('content safety labels', () => {
  it('an unknown decision keeps its raw text with a neutral badge', () => {
    expect(decisionPresentation('future_decision')).toEqual({
      labelKey: 'future_decision',
      variant: 'neutral',
    })
  })

  it('a client canceled failure has its own label', () => {
    expect(failureReasonLabelKey('client_canceled')).toBe('Client canceled')
  })

  it('an inherited object key is not treated as a failure reason', () => {
    expect(failureReasonLabelKey('toString')).toBe('toString')
  })

  it('an unknown failure reason keeps its raw text', () => {
    expect(failureReasonLabelKey('quota_exhausted')).toBe('quota_exhausted')
  })
})

describe('new review decisions and failure reasons', () => {
  it.each([
    ['review_controversial', 'Review controversial', 'warning'],
    ['review_flagged', 'Review flagged', 'danger'],
  ])('%s has its own label and badge color', (decision, labelKey, variant) => {
    expect(decisionPresentation(decision)).toEqual({ labelKey, variant })
  })

  it.each([
    ['refused', 'Review refused by the channel'],
    ['too_many_units', 'Too many pieces to review'],
    ['queue_full', 'Review queue full'],
  ])('failure reason %s has a label', (reason, label) => {
    expect(failureReasonLabelKey(reason)).toBe(label)
  })

  it('the removed too_many_windows reason keeps its raw text', () => {
    expect(failureReasonLabelKey('too_many_windows')).toBe('too_many_windows')
  })
})

describe('review mode and reviewed decisions', () => {
  it.each([
    ['sync', 'Synchronous'],
    ['async', 'Background'],
    ['shadow', 'Shadow'],
    ['future_mode', 'future_mode'],
    ['', null],
  ])('mode "%s" maps to %s', (mode, expected) => {
    expect(modeLabelKey(mode)).toBe(expected)
  })

  it.each([
    ['keyword_blocked', false],
    ['review_passed', true],
    ['review_controversial', true],
    ['review_flagged', true],
  ])('decision %s reviewed = %s', (decision, expected) => {
    expect(isReviewedDecision(decision)).toBe(expected)
  })
})

describe('summarizeStatsCounts', () => {
  const row = (
    decision: string,
    total: number,
    failure_reason = '',
    cache_hit = false
  ) => ({ decision, mode: 'sync', failure_reason, cache_hit, total })

  it('adds weighted totals of review decisions and ignores keyword rows', () => {
    expect(
      summarizeStatsCounts([
        row('keyword_blocked', 99),
        row('review_passed', 10),
        row('review_flagged', 2),
        row('review_rejected', 3),
        row('review_controversial', 4),
        row('review_failed', 5, 'timeout'),
        row('review_controversial', 6, 'refused'),
      ])
    ).toEqual({
      reviews: 30,
      flaggedOrRejected: 5,
      controversial: 10,
      failed: 5,
      refused: 6,
    })
  })

  it('counts as reviews neither cache hits nor reviews stopped before asking the reviewer', () => {
    expect(
      summarizeStatsCounts([
        row('review_passed', 10),
        row('review_flagged', 2, '', true),
        row('review_controversial', 3, '', true),
        row('review_failed', 4, 'rate_limited'),
        row('review_failed', 5, 'queue_full'),
        row('review_failed', 6, 'too_many_units'),
        row('review_failed', 7, 'timeout'),
      ])
    ).toEqual({
      reviews: 17,
      flaggedOrRejected: 2,
      controversial: 3,
      failed: 22,
      refused: 0,
    })
  })

  it('an empty list sums to zero', () => {
    expect(summarizeStatsCounts([])).toEqual({
      reviews: 0,
      flaggedOrRejected: 0,
      controversial: 0,
      failed: 0,
      refused: 0,
    })
  })
})
