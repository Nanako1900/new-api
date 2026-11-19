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

import { keyGroupUpdate, keyModelLimits, keyQuota } from '../lib/meow-keys'
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

test('keys without enabled model limits leave the models to their group', () => {
  expect(keyModelLimits(makeKey({ model_limits: 'gpt-6-sol' }))).toBeNull()
})

test('enabled model limits list each model once trimmed', () => {
  const key = makeKey({
    model_limits_enabled: true,
    model_limits: 'gemini-pro, gpt-6-sol,claude-opus',
  })
  expect(keyModelLimits(key)).toEqual([
    'gemini-pro',
    'gpt-6-sol',
    'claude-opus',
  ])
})

test('enabled model limits with an empty list leave the models to their group', () => {
  const key = makeKey({ model_limits_enabled: true, model_limits: ' , ' })
  expect(keyModelLimits(key)).toBeNull()
})

test('a group change keeps the quota, expiry, limits and IP settings of the key', () => {
  const key = makeKey({
    id: 7,
    name: 'codex',
    remain_quota: 1234,
    expired_time: 1_900_000_000,
    model_limits_enabled: true,
    model_limits: 'gpt-6-sol',
    allow_ips: '192.0.2.1',
    allow_user_quota_query: true,
    group: 'CC Max',
  })
  expect(keyGroupUpdate(key, 'GPT Pro号池')).toEqual({
    id: 7,
    name: 'codex',
    remain_quota: 1234,
    expired_time: 1_900_000_000,
    unlimited_quota: false,
    model_limits_enabled: true,
    model_limits: 'gpt-6-sol',
    allow_ips: '192.0.2.1',
    allow_user_quota_query: true,
    group: 'GPT Pro号池',
    auto_groups: [],
    cross_group_retry: false,
  })
})

test('a move to auto keeps the stored auto order and cross-group retry', () => {
  const key = makeKey({
    group: 'auto',
    auto_groups: ['CC Max', '其他'],
    cross_group_retry: true,
  })
  const update = keyGroupUpdate(key, 'auto')
  expect(update.auto_groups).toEqual(['CC Max', '其他'])
  expect(update.cross_group_retry).toBe(true)
})

test('a move away from auto drops the auto order and cross-group retry', () => {
  const key = makeKey({
    group: 'auto',
    auto_groups: ['CC Max'],
    cross_group_retry: true,
  })
  const update = keyGroupUpdate(key, '其他')
  expect(update.auto_groups).toEqual([])
  expect(update.cross_group_retry).toBe(false)
})
