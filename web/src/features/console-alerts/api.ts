import { api } from '@/lib/api'

import type { GetActiveAlertsResponse } from './types'

export async function getActiveAlerts(): Promise<GetActiveAlertsResponse> {
  const res = await api.get('/api/alerts')
  return res.data
}
