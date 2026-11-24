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
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

import {
  markAuditReadRevoked,
  refreshUserCapabilities,
} from '@/features/usage-logs/audit/lib/audit-access'
import { getServerErrorStatus } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Leaves for /403 and records the lost audit read permission when a content
 * safety request answers 403. Returns whether access was denied.
 */
export function useAuditForbiddenRedirect(error: unknown): boolean {
  const navigate = useNavigate()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const accessDenied = getServerErrorStatus(error) === 403
  useEffect(() => {
    if (!accessDenied) return
    markAuditReadRevoked(userId)
    void navigate({ to: '/403', replace: true })
    void refreshUserCapabilities(userId)
  }, [accessDenied, navigate, userId])
  return accessDenied
}
