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
  parseStringList,
} from '../lib/log-fields'

describe('parseStringList', () => {
  it.each([
    ['a JSON string array', '["knife","gun"]', ['knife', 'gun']],
    ['an empty value', '', []],
    ['an empty JSON array', '[]', []],
    [
      'an array with repeated, empty and non-string entries',
      '["knife",1,"knife",null,""]',
      ['knife'],
    ],
    ['invalid JSON', '["knife"', ['["knife"']],
    ['JSON that is not an array', '{"word":"knife"}', ['{"word":"knife"}']],
  ])('turns %s into the stored entries', (_case, raw, expected) => {
    expect(parseStringList(raw)).toEqual(expected)
  })
})

describe('content safety labels', () => {
  it('an unknown decision keeps its raw text with a neutral badge', () => {
    expect(decisionPresentation('future_decision')).toEqual({
      labelKey: 'future_decision',
      variant: 'neutral',
    })
  })

  it('an unknown failure reason keeps its raw text', () => {
    expect(failureReasonLabelKey('quota_exhausted')).toBe('quota_exhausted')
  })
})
