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

import { lastSevenDays } from '../lib/meow-checkin'
import { dailyProviderSpend, modelVendor } from '../lib/meow-usage'

const DAYS = lastSevenDays(new Date(2026, 10, 3))
const at = (day: number, hour: number) =>
  Math.floor(new Date(2026, 10, day, hour).getTime() / 1000)

test('spend is summed per day and split by provider', () => {
  const result = dailyProviderSpend(
    [
      { model_name: 'claude-sonnet', created_at: at(3, 9), quota: 100 },
      { model_name: 'claude-opus', created_at: at(3, 15), quota: 50 },
      { model_name: 'gpt-6-sol', created_at: at(3, 10), quota: 30 },
      { model_name: 'gemini-pro', created_at: at(3, 11), quota: 5 },
    ],
    DAYS
  )
  expect(result.at(-1)).toMatchObject({
    values: { claude: 150, gpt: 30, other: 5 },
    total: 185,
  })
})

test('every requested day is returned in order, empty days as zero', () => {
  const result = dailyProviderSpend([], DAYS)
  expect(result).toHaveLength(7)
  expect(result.every((day) => day.total === 0)).toBe(true)
  expect(result[0].date).toEqual(DAYS[0])
})

test('items outside the requested days or without quota are ignored', () => {
  const result = dailyProviderSpend(
    [
      { model_name: 'claude-sonnet', created_at: at(20, 9), quota: 100 },
      { model_name: 'gpt-6-sol', created_at: at(2, 9), quota: 0 },
    ],
    DAYS
  )
  expect(result.reduce((sum, day) => sum + day.total, 0)).toBe(0)
})

test('modelVendor puts OpenAI o-series under GPT and leaves other o-names out', () => {
  expect(modelVendor('o3')).toBe('gpt')
  expect(modelVendor('o4-mini')).toBe('gpt')
  expect(modelVendor('claude-sonnet-4-5')).toBe('claude')
  expect(modelVendor('omni-moderation-latest')).toBe('other')
  expect(modelVendor('gemini-2.5-pro')).toBe('other')
})
