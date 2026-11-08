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
import type { ConsoleAlert } from '../types'

export type AlertStatus = 'live' | 'scheduled' | 'expired' | 'disabled'

/**
 * Mirrors the server's active-alert filter (GetActiveAlerts) so the admin
 * list shows what signed-in users currently see.
 */
export function getAlertStatus(
  alert: Pick<ConsoleAlert, 'enabled' | 'startsAt' | 'endsAt'>,
  now: number
): AlertStatus {
  if (!alert.enabled) return 'disabled'
  if (alert.startsAt && now < new Date(alert.startsAt).getTime()) {
    return 'scheduled'
  }
  if (alert.endsAt && now >= new Date(alert.endsAt).getTime()) {
    return 'expired'
  }
  return 'live'
}
