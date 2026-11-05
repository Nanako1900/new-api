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
  buildSetupSnippet,
  greetingFor,
  healthBadge,
  maskApiKey,
  splitAroundName,
} from '../lib/meow-setup'

const ROOT = 'https://meowapi.dev'

test('Claude Code snippet uses the site root without /v1 and the given key', () => {
  const snippet = buildSetupSnippet('claude-code', ROOT, 'sk-real')
  expect(snippet).toContain('export ANTHROPIC_BASE_URL=https://meowapi.dev\n')
  expect(snippet).toContain('export ANTHROPIC_AUTH_TOKEN=sk-real')
  expect(snippet).not.toContain('/v1')
})

test.each(['codex', 'sdk'] as const)(
  '%s snippet points at the OpenAI-compatible /v1 base URL',
  (client) => {
    expect(buildSetupSnippet(client, ROOT, 'sk-real')).toContain(
      'https://meowapi.dev/v1"'
    )
  }
)

test('masked keys keep the prefix and last four characters only', () => {
  expect(maskApiKey('abcdefghijklmnopqrstuvwxyz')).toBe('sk-abcd…wxyz')
  expect(maskApiKey('sk-abcdefghijklmnopqrstuvwxyz')).toBe('sk-abcd…wxyz')
  expect(maskApiKey(undefined)).toBe('sk-…')
})

test.each([
  [4, 'evening'],
  [5, 'morning'],
  [11, 'morning'],
  [12, 'afternoon'],
  [17, 'afternoon'],
  [18, 'evening'],
] as const)('hour %i greets with %s', (hour, expected) => {
  expect(greetingFor(hour)).toBe(expected)
})

test('splitAroundName returns the text before and after the name', () => {
  const parts = splitAroundName((name) => `下午好，${name}！`)
  expect(parts).toEqual({ before: '下午好，', after: '！' })
})

test('splitAroundName keeps the whole text when a locale drops the name', () => {
  expect(splitAroundName(() => 'Hello')).toEqual({ before: 'Hello', after: '' })
})

test.each([
  ['excellent', 'healthy'],
  ['good', 'healthy'],
  ['warning', 'degraded'],
  ['critical', 'unstable'],
  ['unknown', 'unknown'],
] as const)('healthBadge maps %s to %s', (level, badge) => {
  expect(healthBadge(level)).toBe(badge)
})
