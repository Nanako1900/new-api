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
import type { AlertLevel } from './constants'

export type ConsoleAlert = {
  id: number
  title?: string
  content: string
  level: AlertLevel
  dismissible: boolean
  enabled: boolean
  startsAt?: string
  endsAt?: string
}

export type GetActiveAlertsResponse = {
  success: boolean
  message?: string
  data?: ConsoleAlert[]
}

/**
 * An alert as users last saw it, kept by the server after the alert ends or
 * is deleted (`console_setting.alert_history`).
 */
export type AlertHistoryEntry = Pick<
  ConsoleAlert,
  'id' | 'title' | 'content' | 'level'
> & {
  /** RFC 3339 time the alert went live */
  publishedAt: string
  /** RFC 3339 time of the last edit users saw */
  updatedAt?: string
}

export type GetAlertHistoryResponse = {
  success: boolean
  message?: string
  data?: AlertHistoryEntry[]
}
