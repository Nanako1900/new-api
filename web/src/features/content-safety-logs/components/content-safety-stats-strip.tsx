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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { useContentSafetyStats } from '../api'
import { CONTENT_SAFETY_STATS_RANGES } from '../constants'
import { useAuditForbiddenRedirect } from '../hooks/use-audit-forbidden-redirect'
import { summarizeStatsCounts } from '../lib/log-fields'
import type { ContentSafetyStats, ContentSafetyStatsHours } from '../types'

type StatFigure = { label: string; value: string }

function statFigures(
  stats: ContentSafetyStats,
  locale: string | undefined,
  t: (key: string) => string
): StatFigure[] {
  const summary = summarizeStatsCounts(stats.counts)
  const unit = t('ms')
  return [
    { label: t('Reviews'), value: formatNumber(summary.reviews, locale) },
    {
      label: t('Flagged or rejected'),
      value: formatNumber(summary.flaggedOrRejected, locale),
    },
    {
      label: t('Controversial'),
      value: formatNumber(summary.controversial, locale),
    },
    { label: t('Failed'), value: formatNumber(summary.failed, locale) },
    { label: t('Refused'), value: formatNumber(summary.refused, locale) },
    {
      label: t('Latency p50'),
      value: `${formatNumber(stats.latency_p50_ms, locale)} ${unit}`,
    },
    {
      label: t('Latency p95'),
      value: `${formatNumber(stats.latency_p95_ms, locale)} ${unit}`,
    },
  ]
}

export function ContentSafetyStatsStrip() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [hours, setHours] = useState<ContentSafetyStatsHours>(24)
  const query = useContentSafetyStats(hours)
  useAuditForbiddenRedirect(query.error)

  return (
    <section
      aria-label={t('Review statistics')}
      className='flex flex-col gap-2 rounded-lg border px-3 py-2'
    >
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h2 className='text-sm font-medium'>{t('Review statistics')}</h2>
        <ToggleGroup
          value={[String(hours)]}
          onValueChange={(value) => {
            const next = CONTENT_SAFETY_STATS_RANGES.find(
              (range) => String(range) === value[0]
            )
            if (next) setHours(next)
          }}
          aria-label={t('Statistics period')}
          variant='outline'
          size='sm'
        >
          <ToggleGroupItem value='24'>{t('24 hours')}</ToggleGroupItem>
          <ToggleGroupItem value='168'>{t('7 days')}</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {query.isPending && (
        <LoadingState inline size='sm' message={t('Loading...')} />
      )}
      {query.isError && (
        <Alert variant='destructive'>
          <AlertDescription className='flex items-center justify-between gap-2'>
            <span>{t('Failed to load content safety statistics')}</span>
            <Button
              size='sm'
              variant='outline'
              onClick={() => void query.refetch()}
            >
              {t('Retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {query.data && (
        <dl className='grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 lg:grid-cols-7'>
          {statFigures(query.data, locale, t).map((figure) => (
            <div key={figure.label} className='min-w-0'>
              <dt className='text-muted-foreground truncate text-xs'>
                {figure.label}
              </dt>
              <dd className='font-mono text-sm tabular-nums'>{figure.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}
