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
import { expect, test } from 'vitest'

import {
  API_DEMOS,
  keyLines,
  renderDemoRequest,
  tokenizeCodeLine,
} from '../lib/api-demos'

test('a quoted string followed by a colon is a key, otherwise a value', () => {
  const tokens = tokenizeCodeLine('  "model": "your-model",')
  expect(tokens.filter((t) => t.kind === 'key').map((t) => t.text)).toEqual([
    '"model"',
  ])
  expect(tokens.filter((t) => t.kind === 'string').map((t) => t.text)).toEqual([
    '"your-model"',
  ])
})

test('curl flags and numbers get their own token kinds', () => {
  const kinds = tokenizeCodeLine('curl -X POST "x" \\').map((t) => t.kind)
  expect(kinds).toContain('flag')
  expect(tokenizeCodeLine('"max_tokens": 1024,')).toContainEqual({
    kind: 'number',
    text: '1024',
    start: 14,
  })
})

test('tokens rebuild the original line exactly', () => {
  const line = '  -H "Authorization: Bearer sk-••••" \\'
  expect(
    tokenizeCodeLine(line)
      .map((t) => t.text)
      .join('')
  ).toBe(line)
})

test('every demo request targets the given site root', () => {
  for (const demo of API_DEMOS) {
    const first = renderDemoRequest(demo, 'https://meowapi.dev')[0]
    expect(first).toContain(`"https://meowapi.dev${demo.endpoint}"`)
  }
})

test('every demo request declares a JSON body so the copied command runs', () => {
  for (const demo of API_DEMOS) {
    expect(demo.request.join('\n')).toMatch(
      /-H "Content-Type: application\/json"/
    )
  }
})

test('line keys stay unique even when lines repeat', () => {
  const keys = keyLines(['{', '}', '{', '}']).map((l) => l.offset)
  expect(new Set(keys).size).toBe(4)
})
