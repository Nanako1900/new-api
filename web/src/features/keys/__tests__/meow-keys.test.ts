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

import { keyModelScopes, keyQuota } from '../lib/meow-keys'
import type { ApiKey } from '../types'

function makeKey(overrides: Partial<ApiKey>): ApiKey {
  return {
    id: 1,
    name: 'Test',
    key: 'abcd',
    status: 1,
    remain_quota: 0,
    used_quota: 0,
    unlimited_quota: false,
    expired_time: -1,
    created_time: 0,
    accessed_time: 0,
    group: '',
    auto_groups: null,
    cross_group_retry: false,
    model_limits_enabled: false,
    model_limits: '',
    allow_ips: '',
    allow_user_quota_query: false,
    ...overrides,
  } as ApiKey
}

test('limited key quota is used against used plus remaining', () => {
  expect(keyQuota(makeKey({ used_quota: 60, remain_quota: 40 }))).toEqual({
    used: 60,
    limit: 100,
    percent: 60,
  })
})

test('unlimited key quota has no limit and no progress', () => {
  expect(keyQuota(makeKey({ unlimited_quota: true, used_quota: 500 }))).toEqual(
    { used: 500, limit: null, percent: 0 }
  )
})

test('a limited key with nothing left shows as fully used', () => {
  expect(keyQuota(makeKey({ used_quota: 0, remain_quota: 0 })).percent).toBe(
    100
  )
})

test('keys without model limits have no scopes', () => {
  expect(keyModelScopes(makeKey({ model_limits: 'gpt-6-sol' }))).toBeNull()
})

test('model limits are grouped into Claude, GPT and other, in that order', () => {
  const key = makeKey({
    model_limits_enabled: true,
    model_limits: 'gemini-pro, gpt-6-sol,claude-opus',
  })
  expect(keyModelScopes(key)).toEqual(['claude', 'gpt', 'other'])
})

test('enabled model limits with an empty list count as all models', () => {
  const key = makeKey({ model_limits_enabled: true, model_limits: ' , ' })
  expect(keyModelScopes(key)).toBeNull()
})
