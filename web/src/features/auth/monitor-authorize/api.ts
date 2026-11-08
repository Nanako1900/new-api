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
import { api } from '@/lib/api'

type MonitorAuthorizeResponse = {
  success: boolean
  data?: { code?: string }
}

// Issues a one-time monitor console authorization code for the current
// dashboard session. Failures surface as Axios errors carrying the server's
// stable error code in response.data.code.
export async function requestMonitorAuthorizationCode(payload: {
  redirect_uri: string
  code_challenge: string
  code_challenge_method: 'S256'
}): Promise<string> {
  const response = await api.post<MonitorAuthorizeResponse>(
    '/api/user/monitor/authorize',
    payload,
    { skipErrorHandler: true, disableDuplicate: true }
  )
  const code = response.data?.data?.code
  if (!response.data?.success || !code) {
    throw new Error('monitor authorization returned no code')
  }
  return code
}

export function monitorAuthorizeErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return undefined
  }
  const data = (error as { response?: { data?: { code?: unknown } } }).response
    ?.data
  return typeof data?.code === 'string' ? data.code : undefined
}
