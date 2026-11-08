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
import { getUserProfile } from '@/features/profile/api'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Records in the auth store that the signed-in user lost `audit:read`, after
 * the server answered 403 to a request that needs it. Only touches the store
 * while `userId` is still the signed-in user.
 */
export function markAuditReadRevoked(userId: number | undefined): void {
  const current = useAuthStore.getState().auth.user
  if (!current || current.id !== userId) return
  useAuthStore.getState().auth.setUser({
    ...current,
    permissions: {
      ...current.permissions,
      admin_permissions: {
        ...current.permissions?.admin_permissions,
        audit: { read: false },
      },
    },
  })
}

/**
 * Reloads the user's role and permissions from the server. A failed refresh
 * keeps the revoked state set by `markAuditReadRevoked`.
 */
export async function refreshUserCapabilities(
  userId: number | undefined
): Promise<void> {
  try {
    const profile = await getUserProfile()
    const latest = useAuthStore.getState().auth.user
    if (
      profile.success &&
      profile.data &&
      latest &&
      profile.data.id === userId &&
      latest.id === userId
    ) {
      useAuthStore.getState().auth.setUser({
        ...latest,
        role: profile.data.role,
        permissions: profile.data.permissions,
      })
    }
  } catch {
    // Keep the denied state when refreshing capabilities fails.
  }
}
