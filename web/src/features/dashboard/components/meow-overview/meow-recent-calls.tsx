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
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { getUserLogs } from '@/features/usage-logs/api'
import { LOG_TYPE_ENUM } from '@/features/usage-logs/constants'
import type { UsageLog } from '@/features/usage-logs/data/schema'
import { toIntlLocale } from '@/i18n/languages'
import {
  formatNumber,
  formatQuota,
  formatTimestampRelative,
} from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'

/** How many recent calls the overview lists. */
const RECENT_CALL_LIMIT = 5

/** The latest consume records, newest first. */
export function MeowRecentCalls() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  const logsQuery = useQuery({
    queryKey: ['dashboard', 'overview', 'recent-calls'],
    queryFn: async () => {
      const result = requireServerSuccess(
        await getUserLogs({
          p: 1,
          page_size: RECENT_CALL_LIMIT,
          type: LOG_TYPE_ENUM.CONSUME,
        })
      )
      return (result.data?.items ?? []) as UsageLog[]
    },
    staleTime: 30 * 1000,
  })

  const logs = logsQuery.data ?? []

  return (
    <div className='bg-card border-border rounded-[22px] border px-6 pt-5 pb-2'>
      <div className='flex items-center justify-between pb-2'>
        <h2 className='text-base font-extrabold'>{t('Recent calls')}</h2>
        <Link
          to='/usage-logs/$section'
          params={{ section: 'common' }}
          className='text-primary inline-flex items-center gap-1 text-[13px] font-bold'
        >
          {t('View logs')}
          <ArrowRight className='size-3.5' aria-hidden='true' />
        </Link>
      </div>

      {logsQuery.isLoading && (
        <div className='flex flex-col gap-2 pb-3'>
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className='h-9 rounded-lg' />
          ))}
        </div>
      )}

      {!logsQuery.isLoading && logs.length === 0 && (
        <p className='text-muted-foreground py-6 text-center text-sm'>
          {t(
            'No calls yet. Copy the config above and send your first request.'
          )}
        </p>
      )}

      {logs.length > 0 && (
        <ul>
          {logs.map((log) => (
            <li
              key={log.id}
              className='border-border/70 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 border-t py-3 text-sm sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_7rem_6rem_6rem]'
            >
              <span className='flex min-w-0 items-center gap-3'>
                <span
                  aria-hidden='true'
                  className='bg-success size-2 shrink-0 rounded-full'
                />
                <span className='truncate font-mono text-[13px]'>
                  {log.model_name || '—'}
                </span>
              </span>
              <span className='text-muted-foreground hidden truncate sm:block'>
                {log.token_name || '—'}
              </span>
              <span className='text-muted-foreground hidden text-right font-mono text-[13px] tabular-nums sm:block'>
                {formatNumber(
                  (log.prompt_tokens ?? 0) + (log.completion_tokens ?? 0),
                  locale
                )}{' '}
                tok
              </span>
              <span className='text-primary text-right font-extrabold tabular-nums'>
                {formatQuota(log.quota ?? 0)}
              </span>
              <span className='text-muted-foreground col-span-2 text-[12px] sm:col-span-1 sm:text-right sm:text-sm'>
                {formatTimestampRelative(log.created_at, 'seconds', locale)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
