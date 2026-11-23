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
import { type Query, useQuery } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { formatTimestamp } from '@/lib/format'

import { type ClaudeApiStatus, getClaudeApiStatus } from './api'

const RETRY_SECONDS = 60
const REFRESH_SECONDS = 5 * 60

function refreshDelay({ state }: Query<ClaudeApiStatus>) {
  if (state.status === 'error') {
    return state.errorUpdatedAt + RETRY_SECONDS * 1000 - Date.now()
  }
  if (!state.data) return 0
  const seconds =
    state.data.refresh_after_seconds ??
    (state.data.stale ? RETRY_SECONDS : REFRESH_SECONDS)
  return state.dataUpdatedAt + seconds * 1000 - Date.now()
}

function isRefreshDue(query: Query<ClaudeApiStatus>) {
  return refreshDelay(query) <= 0
}

function componentStatus(
  status: string,
  t: TFunction
): [string, StatusVariant] {
  switch (status) {
    case 'operational':
      return [t('Operational'), 'success']
    case 'degraded_performance':
      return [t('Degraded performance'), 'warning']
    case 'partial_outage':
      return [t('Partial outage'), 'warning']
    case 'major_outage':
      return [t('Major outage'), 'danger']
    case 'under_maintenance':
      return [t('Maintenance'), 'info']
    default:
      return [t('Unknown'), 'neutral']
  }
}

function incidentPhase(status: string, t: TFunction): string {
  switch (status) {
    case 'investigating':
      return t('Investigating')
    case 'identified':
      return t('Identified')
    case 'monitoring':
      return t('Monitoring')
    default:
      return ''
  }
}

export function ClaudeOfficialStatus() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['claude-official-status'],
    queryFn: getClaudeApiStatus,
    staleTime: 0,
    retryOnMount: isRefreshDue,
    refetchOnMount: isRefreshDue,
    refetchOnWindowFocus: isRefreshDue,
    refetchOnReconnect: isRefreshDue,
    refetchInterval: (query) => {
      if (query.state.fetchStatus !== 'idle') return false
      const delay = refreshDelay(query)
      return delay > 0 ? delay : 1000
    },
    retry: false,
    meta: { errorToast: false, errorPage: false },
  })
  const report = query.data
  const outdated = report?.stale || query.isError
  const pendingLabel = query.isPending ? t('Loading...') : t('Unavailable')
  const [label, variant] = report
    ? componentStatus(report.status, t)
    : [pendingLabel, 'neutral' as const]

  return (
    <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm'>
      <a
        className='inline-flex items-center gap-1 font-semibold underline-offset-4 hover:underline focus-visible:underline'
        href='https://status.claude.com'
        target='_blank'
        rel='noopener noreferrer'
      >
        {t('Claude API official status')}
        <ExternalLink aria-hidden='true' className='size-3' />
      </a>
      <StatusBadge
        type='text'
        label={label}
        variant={outdated ? 'neutral' : variant}
        showDot
        copyable={false}
      />
      {report && (
        <>
          {outdated && (
            <span className='text-warning text-xs'>
              {t('Showing last known status')}
            </span>
          )}
          <span className='text-muted-foreground text-xs'>
            {t('Last successful check')}{' '}
            <time dateTime={new Date(report.checked_at * 1000).toISOString()}>
              {formatTimestamp(report.checked_at)}
            </time>
          </span>
          {report.incidents.length > 0 && (
            <ul className='text-muted-foreground w-full space-y-0.5 text-xs'>
              {report.incidents.map((incident) => {
                const phase = incidentPhase(incident.status, t)
                return (
                  <li key={incident.id} className='wrap-anywhere'>
                    <span>{incident.name}</span>
                    {phase && <> · {phase}</>}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
