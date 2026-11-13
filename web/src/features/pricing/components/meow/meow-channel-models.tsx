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
import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { translateServerText } from '@/lib/server-error-message'

import { useMeowChannelPerf } from '../../hooks/use-meow-channel-perf'
import {
  channelUsageDescription,
  type MeowChannel,
} from '../../lib/meow-catalog'
import { officialPriceFactor } from '../../lib/official-price'
import { MeowChannelTable } from './meow-channel-table'
import type { MeowPriceOptions } from './meow-model-row'
import { MeowOfficialPriceBadge } from './meow-official-price-badge'

export function MeowChannelModels(props: {
  channel: MeowChannel
  prices: MeowPriceOptions
  onSelect: (model: string) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [search, setSearch] = useState('')
  const models = useMemo(() => {
    const query = search.trim().toLowerCase()
    return props.channel.models.filter((model) =>
      model.model_name.toLowerCase().includes(query)
    )
  }, [props.channel.models, search])
  const modelNames = useMemo(
    () => models.map((model) => model.model_name),
    [models]
  )
  const perf = useMeowChannelPerf(modelNames)

  return (
    <section
      aria-label={t('Channel models')}
      className='bg-card overflow-hidden rounded-2xl border'
    >
      <div className='space-y-4 px-4 py-5 sm:px-5'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div className='min-w-0 space-y-1'>
            <h2 className='text-xl font-semibold break-words'>
              {props.channel.group}
            </h2>
            <p className='text-muted-foreground text-sm break-words'>
              {translateServerText(t, channelUsageDescription(props.channel))}
            </p>
          </div>
          <MeowOfficialPriceBadge
            factor={officialPriceFactor(props.channel.ratio, props.prices)}
          />
        </div>
        <div className='bg-muted/40 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-3 py-2 text-xs'>
          <span className='text-muted-foreground'>{t('Token group')}</span>
          <code className='break-all'>{props.channel.group}</code>
          <CopyButton
            value={props.channel.group}
            tooltip={t('Copy group name')}
            className='size-6'
            iconClassName='size-3'
          />
          <span className='text-muted-foreground'>
            {t('Select this group when creating an API key.')}
          </span>
        </div>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <p className='text-muted-foreground text-sm' role='status'>
            {t('Showing {{visible}} of {{total}} models', {
              visible: formatNumber(models.length, locale),
              total: formatNumber(props.channel.models.length, locale),
            })}
          </p>
          <div className='relative w-full sm:w-72'>
            <Search
              aria-hidden
              className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2'
            />
            <Input
              type='search'
              aria-label={t('Search models in this channel')}
              placeholder={t('Search models in this channel')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className='pl-9'
            />
          </div>
        </div>
      </div>
      {models.length > 0 ? (
        <MeowChannelTable
          familyName={t('Models')}
          channel={{ ...props.channel, models }}
          showBadge={false}
          prices={props.prices}
          perf={perf}
          onSelect={props.onSelect}
        />
      ) : (
        <EmptyState
          icon={Search}
          title={t('No matching models in this channel')}
          description={t(
            'Try a different model name or choose another channel.'
          )}
          action={
            <Button variant='outline' onClick={() => setSearch('')}>
              {t('Clear search')}
            </Button>
          }
        />
      )}
      <p className='text-muted-foreground border-t px-4 py-3 text-xs sm:px-5'>
        {t(
          'Prices include the selected channel multiplier. Status covers the last 24 hours.'
        )}
      </p>
    </section>
  )
}
