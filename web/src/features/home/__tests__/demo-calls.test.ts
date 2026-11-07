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

import { buildDemoCalls, visibleDemoCalls } from '../lib/demo-calls'

test('demo calls take each provider’s listed models in turn', () => {
  const calls = buildDemoCalls({
    claude: ['claude-sonnet', 'claude-opus'],
    gpt: ['gpt-mini'],
  })

  expect(
    calls.filter((call) => call.provider === 'claude').map((call) => call.model)
  ).toEqual(['claude-sonnet', 'claude-opus', 'claude-sonnet'])
  expect(
    calls.filter((call) => call.provider === 'gpt').map((call) => call.model)
  ).toEqual(['gpt-mini', 'gpt-mini', 'gpt-mini'])
})

test('a provider without listed models uses its family name', () => {
  const calls = buildDemoCalls({ claude: [], gpt: [] })

  expect(new Set(calls.map((call) => call.model))).toEqual(
    new Set(['claude', 'gpt'])
  )
})

test('visible rows list the newest call first and wrap around the list', () => {
  const calls = buildDemoCalls({ claude: [], gpt: [] })

  const rows = visibleDemoCalls(calls, calls.length + 1, 3)

  expect(rows.map((row) => row.seq)).toEqual([
    calls.length + 1,
    calls.length,
    calls.length - 1,
  ])
  expect(rows[0]).toMatchObject(calls[1])
  expect(rows[1]).toMatchObject(calls[0])
  expect(rows[2]).toMatchObject(calls.at(-1) ?? {})
})

test('a row keeps its key when a newer call arrives above it', () => {
  const calls = buildDemoCalls({ claude: [], gpt: [] })

  const before = visibleDemoCalls(calls, 3, 4)
  const after = visibleDemoCalls(calls, 4, 4)

  expect(after.slice(1)).toEqual(before.slice(0, 3))
})

test('an empty call list shows no rows', () => {
  expect(visibleDemoCalls([], 5, 4)).toEqual([])
})
