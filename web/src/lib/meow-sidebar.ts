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
import type { NavGroup, NavItem } from '@/components/layout/types'

/**
 * MeowAPI: entries regular users don't get, in the order they appear at the
 * top of the Admin group (which only admins see).
 */
const ADMIN_ONLY = ['/usage-logs/task', 'chat-presets']

function adminOnlyRank(item: NavItem): number {
  if ('type' in item && item.type === 'chat-presets') {
    return ADMIN_ONLY.indexOf('chat-presets')
  }
  if ('url' in item && typeof item.url === 'string') {
    return ADMIN_ONLY.indexOf(item.url)
  }
  return -1
}

/**
 * Move the admin-only entries (task logs, chat presets)
 * from their groups to the start of the Admin group. Visibility settings
 * still apply to them as before; only their place changes.
 */
export function moveAdminOnlyItems(groups: NavGroup[]): NavGroup[] {
  const moved: NavItem[] = []
  const rest = groups.map((group) => {
    if (group.id === 'admin') return group
    const items = group.items.filter((item) => {
      if (adminOnlyRank(item) === -1) return true
      moved.push(item)
      return false
    })
    return items.length === group.items.length ? group : { ...group, items }
  })
  if (moved.length === 0) return groups

  moved.sort((a, b) => adminOnlyRank(a) - adminOnlyRank(b))
  return rest.map((group) =>
    group.id === 'admin'
      ? { ...group, items: [...moved, ...group.items] }
      : group
  )
}
