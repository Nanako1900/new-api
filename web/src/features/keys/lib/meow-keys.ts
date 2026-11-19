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
import type { ApiKey, ApiKeyFormData } from '../types'

/** Query key prefix of the MeowAPI key list pages. */
export const MEOW_KEY_LIST_KEY = ['keys', 'meow'] as const

export type MeowKeyList = { items: ApiKey[]; total: number }

export type KeyQuota = {
  used: number
  /** Total quota (used + remaining), or null when unlimited. */
  limit: number | null
  /** Share of the limit already used, 0-100. */
  percent: number
}

/** Used quota against the key's limit. */
export function keyQuota(key: ApiKey): KeyQuota {
  const used = Math.max(key.used_quota, 0)
  if (key.unlimited_quota) return { used, limit: null, percent: 0 }
  const limit = used + Math.max(key.remain_quota, 0)
  const percent = limit > 0 ? Math.min((used / limit) * 100, 100) : 100
  return { used, limit, percent }
}

/**
 * Models the key is limited to on top of its group, or null when the group
 * alone decides what it can call.
 */
export function keyModelLimits(key: ApiKey): string[] | null {
  if (!key.model_limits_enabled) return null
  const models = (key.model_limits || '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean)
  return models.length > 0 ? models : null
}

/**
 * Full update body that moves a key to another group and keeps every other
 * setting. Build it from a freshly fetched key: the update overwrites the
 * remaining quota, which drops as the key is used.
 */
export function keyGroupUpdate(
  key: ApiKey,
  group: string
): ApiKeyFormData & { id: number } {
  const isAuto = group === 'auto'
  return {
    id: key.id,
    name: key.name,
    remain_quota: key.remain_quota,
    expired_time: key.expired_time,
    unlimited_quota: key.unlimited_quota,
    model_limits_enabled: key.model_limits_enabled,
    model_limits: key.model_limits ?? '',
    allow_ips: key.allow_ips ?? '',
    allow_user_quota_query: key.allow_user_quota_query,
    group,
    auto_groups: isAuto ? (key.auto_groups ?? []) : [],
    cross_group_retry: isAuto && key.cross_group_retry,
  }
}
