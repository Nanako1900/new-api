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
import { providerOf } from '@/features/home/lib/provider-models'

import type { ApiKey } from '../types'

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

export type KeyModelScope = 'claude' | 'gpt' | 'other'

/**
 * Model families a key may call, in display order, or null when the key is
 * not limited to specific models.
 */
export function keyModelScopes(key: ApiKey): KeyModelScope[] | null {
  if (!key.model_limits_enabled) return null
  const models = (key.model_limits || '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean)
  if (models.length === 0) return null
  const scopes = new Set<KeyModelScope>(
    models.map((model) => providerOf(model) ?? 'other')
  )
  return (['claude', 'gpt', 'other'] as const).filter((scope) =>
    scopes.has(scope)
  )
}
