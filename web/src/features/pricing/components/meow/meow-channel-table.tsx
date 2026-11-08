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
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { MeowChannel, MeowChannelPerf } from '../../lib/meow-catalog'
import {
  MEOW_ROW_GRID,
  MeowModelRow,
  type MeowPriceOptions,
} from './meow-model-row'

export interface MeowChannelBadgeProps {
  channel: MeowChannel
  asHeading: boolean
  className?: string
}

/** Channel name, its price multiplier and the token group to pick. */
export function MeowChannelBadge(props: MeowChannelBadgeProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const Label = props.asHeading ? 'h3' : 'span'

  return (
    <div
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm',
        props.className
      )}
    >
      <Label className='font-semibold'>{props.channel.label}</Label>
      <span
        title={t('Group Ratio')}
        className='bg-primary/10 text-primary rounded-md px-1.5 py-0.5 font-mono text-xs'
      >
        ×{formatNumber(props.channel.ratio, locale)}
      </span>
      <span className='text-muted-foreground flex items-center gap-1 text-xs'>
        {t('Token group')}
        <code className='font-mono'>{props.channel.group}</code>
        <CopyButton
          value={props.channel.group}
          tooltip={t('Copy group name')}
          className='size-6'
          iconClassName='size-3'
        />
      </span>
    </div>
  )
}

export interface MeowChannelTableProps {
  familyName: string
  channel: MeowChannel
  showBadge: boolean
  prices: MeowPriceOptions
  perf: MeowChannelPerf
  onSelect: (modelName: string) => void
}

export function MeowChannelTable(props: MeowChannelTableProps) {
  const { t } = useTranslation()

  return (
    <div className='border-t'>
      {props.showBadge && (
        <MeowChannelBadge
          channel={props.channel}
          asHeading
          className='px-4 pt-3 pb-1'
        />
      )}
      <div
        role='table'
        aria-label={`${props.familyName} · ${props.channel.label}`}
      >
        <div
          role='row'
          className={cn(
            'text-muted-foreground hidden gap-x-3 px-4 py-2 text-xs md:grid',
            MEOW_ROW_GRID
          )}
        >
          <div role='columnheader'>{t('Model')}</div>
          <div role='columnheader'>{t('Input')}</div>
          <div role='columnheader'>{t('Output')}</div>
          <div role='columnheader'>{t('Cache Read')}</div>
          <div role='columnheader'>{t('24h status')}</div>
          <div role='columnheader'>
            {`${t('Latency short')} · ${t('Throughput short')}`}
          </div>
        </div>
        {props.channel.models.map((model) => (
          <MeowModelRow
            key={model.model_name}
            model={model}
            group={props.channel.group}
            ratio={props.channel.ratio}
            prices={props.prices}
            perf={props.perf.byModel
              .get(model.model_name)
              ?.get(props.channel.group)}
            windowEnd={props.perf.windowEnd}
            onSelect={props.onSelect}
          />
        ))}
      </div>
    </div>
  )
}
