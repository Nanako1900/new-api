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
import { Claude, OpenAI } from '@lobehub/icons'
import { Boxes } from 'lucide-react'
import type { ComponentType } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import type {
  MeowChannelPerf,
  MeowFamily,
  MeowFamilyId,
} from '../../lib/meow-catalog'
import { officialPriceFactor } from '../../lib/official-price'
import { MeowChannelBadge, MeowChannelTable } from './meow-channel-table'
import type { MeowPriceOptions } from './meow-model-row'
import { MeowOfficialPriceBadge } from './meow-official-price-badge'

type FamilyMeta = {
  name?: string
  vendor?: string
  icon: ComponentType<{ size?: number; className?: string }>
  tile: string
}

// Same icon tiles as the home page provider cards.
const FAMILY_META: Record<MeowFamilyId, FamilyMeta> = {
  claude: {
    name: 'Claude',
    vendor: 'Anthropic',
    icon: Claude,
    tile: 'bg-meow-orange text-meow-ink dark:bg-white/10 dark:text-white',
  },
  gpt: {
    name: 'GPT',
    vendor: 'OpenAI',
    icon: OpenAI,
    tile: 'bg-meow-ink text-white dark:bg-white/10',
  },
  other: { icon: Boxes, tile: 'bg-muted text-muted-foreground' },
}

export interface MeowFamilyCardProps {
  family: MeowFamily
  prices: MeowPriceOptions
  perf: MeowChannelPerf
  onSelect: (modelName: string) => void
}

export function MeowFamilyCard(props: MeowFamilyCardProps) {
  const { t } = useTranslation()
  const meta = FAMILY_META[props.family.id]
  const name = meta.name ?? t('Other')
  const Icon = meta.icon
  const singleChannel =
    props.family.channels.length === 1 ? props.family.channels[0] : null
  // A single channel carries its own badge; the family repeats only the best.
  const bestFactor = singleChannel
    ? null
    : Math.min(
        ...props.family.channels.map((channel) =>
          officialPriceFactor(channel.ratio, props.prices)
        )
      )

  return (
    <section
      aria-label={name}
      className='bg-card overflow-hidden rounded-2xl border'
    >
      <div className='bg-muted/40 flex flex-wrap items-center gap-3 px-4 py-3'>
        <span
          aria-hidden
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg',
            meta.tile
          )}
        >
          <Icon size={20} />
        </span>
        <div className='min-w-0'>
          <h2 className='text-base font-bold'>{name}</h2>
          {meta.vendor && (
            <p className='text-muted-foreground text-xs'>{meta.vendor}</p>
          )}
        </div>
        {bestFactor !== null && (
          <MeowOfficialPriceBadge
            factor={bestFactor}
            best
            className='ml-auto h-6 px-2.5 text-sm'
          />
        )}
        {singleChannel && (
          <MeowChannelBadge
            channel={singleChannel}
            prices={props.prices}
            asHeading={false}
            className='ml-auto'
          />
        )}
      </div>
      {props.family.channels.map((channel) => (
        <MeowChannelTable
          key={channel.group}
          familyName={name}
          channel={channel}
          showBadge={!singleChannel}
          prices={props.prices}
          perf={props.perf}
          onSelect={props.onSelect}
        />
      ))}
    </section>
  )
}
