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
import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslation } from 'react-i18next'

import { RollingNumber } from '@/components/rolling-number'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'

/** A consistent destination for detailed analytics from overview summaries. */
export function MeowDashboardLink(props: { compact?: boolean }) {
  const { t } = useTranslation()
  const label = props.compact
    ? t('Monitoring site')
    : t('Open dedicated monitoring site')

  return (
    <Button
      role='link'
      aria-label={`${label} · ${t('Open in new tab')}`}
      variant={props.compact ? 'outline' : 'default'}
      size={props.compact ? 'sm' : 'lg'}
      className={
        props.compact
          ? 'h-auto min-h-7 max-w-full'
          : 'h-auto min-h-14 w-full justify-between rounded-xl px-4 py-2.5'
      }
      nativeButton={false}
      render={
        <a
          href='https://dash.meowapi.dev'
          target='_blank'
          rel='noopener noreferrer'
          title='dash.meowapi.dev'
        />
      }
    >
      <span className='flex min-w-0 flex-col gap-1 text-start'>
        <span className='flex flex-wrap items-baseline gap-x-3 gap-y-0.5'>
          <span className='font-semibold whitespace-normal'>{label}</span>
          {!props.compact && (
            <span className='font-mono text-[11px] opacity-80'>
              dash.meowapi.dev
            </span>
          )}
        </span>
        {!props.compact && (
          <span className='text-xs whitespace-normal opacity-80'>
            {t('Detailed analytics and live logs')}
          </span>
        )}
      </span>
      <HugeiconsIcon
        icon={ArrowUpRight01Icon}
        data-icon='inline-end'
        aria-hidden='true'
      />
    </Button>
  )
}

export function MeowAnalyticsCard(props: {
  quota: number
  requestCount: number
  isLoading: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  return (
    <Card className='h-full gap-0 rounded-[22px] py-0' data-card-hover='false'>
      <CardContent className='flex h-full flex-col justify-between gap-3 p-5 sm:px-6'>
        <dl className='grid grid-cols-2 gap-6'>
          <div className='flex min-w-0 flex-col gap-2'>
            <dt className='text-muted-foreground text-xs font-medium'>
              {t('Spend (24h)')}
            </dt>
            <dd className='text-meow-heading text-2xl leading-tight font-bold tracking-tight break-all tabular-nums'>
              {props.isLoading ? (
                '—'
              ) : (
                <RollingNumber value={props.quota} format={formatQuota} />
              )}
            </dd>
          </div>
          <div className='flex min-w-0 flex-col gap-2'>
            <dt className='text-muted-foreground text-xs font-medium'>
              {t('Requests (24h)')}
            </dt>
            <dd className='text-2xl leading-tight font-bold tracking-tight break-all tabular-nums'>
              {props.isLoading ? (
                '—'
              ) : (
                <RollingNumber
                  value={props.requestCount}
                  format={(count) => formatNumber(count, locale)}
                />
              )}
            </dd>
          </div>
        </dl>
        <MeowDashboardLink />
      </CardContent>
    </Card>
  )
}
