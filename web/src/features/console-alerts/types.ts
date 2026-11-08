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
