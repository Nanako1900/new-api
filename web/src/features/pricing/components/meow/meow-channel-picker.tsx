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
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { GroupSelector } from '@/components/model-group-selector'
import { Badge } from '@/components/ui/badge'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { translateServerText } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import {
  channelUsageDescription,
  type MeowChannel,
} from '../../lib/meow-catalog'

const CHANNEL_OPTION_CLASSNAME =
  'relative h-auto min-w-0 items-stretch overflow-hidden rounded-xl border border-border/80 bg-card/60 p-4 text-left whitespace-normal shadow-none transition-[background-color,border-color,box-shadow] hover:border-primary/40 hover:bg-accent/50 data-[checked=true]:border-primary/70! data-[checked=true]:bg-primary/8! data-[checked=true]:shadow-sm before:absolute before:inset-y-4 before:left-0 before:w-0.5 before:rounded-r-full before:bg-transparent data-[checked=true]:before:bg-primary'

type MeowChannelPickerProps = {
  channels: MeowChannel[]
  value: string
  onChange: (group: string) => void
}

/** The same channel summary inside desktop cards and the mobile picker. */
function MeowChannelOption(props: { channel: MeowChannel; selected: boolean }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  return (
    <span className='flex w-full min-w-0 items-stretch justify-between gap-4'>
      <span className='flex min-w-0 flex-1 flex-col items-start gap-1.5'>
        <span className='flex w-full items-start gap-2'>
          <span className='min-w-0 text-sm leading-5 font-semibold break-words'>
            {props.channel.group}
          </span>
          <Check
            aria-hidden
            className={cn(
              'text-primary mt-0.5 size-4 shrink-0',
              !props.selected && 'invisible'
            )}
          />
        </span>
        <span className='text-muted-foreground text-xs leading-5 font-normal break-words'>
          {translateServerText(t, channelUsageDescription(props.channel)) ||
            t('Model access and pricing')}
        </span>
        <Badge
          variant='secondary'
          className='mt-1 gap-1.5 text-[11px] font-normal'
        >
          <span className='font-medium tabular-nums'>
            {formatNumber(props.channel.models.length, locale)}
          </span>
          {t('Models')}
        </Badge>
      </span>
      <span className='flex shrink-0 flex-col items-end justify-center gap-1.5'>
        <span
          className={cn(
            'flex items-baseline gap-0.5 text-2xl leading-none font-semibold tracking-tight tabular-nums',
            props.selected && 'text-primary'
          )}
        >
          <span className='text-muted-foreground text-sm font-normal'>×</span>
          {formatNumber(props.channel.ratio, locale)}
        </span>
        <span className='text-muted-foreground text-[11px] font-normal'>
          {t('Ratio')}
        </span>
      </span>
    </span>
  )
}

/** A visible channel overview on desktop; the shared picker on mobile. */
export function MeowChannelPicker(props: MeowChannelPickerProps) {
  const { t } = useTranslation()

  return (
    <div className='mb-5'>
      <div className='sm:hidden'>
        <GroupSelector
          compact={false}
          selectedGroup={props.value}
          onGroupChange={props.onChange}
          groups={props.channels.map((channel) => ({
            value: channel.group,
            label: channel.group,
            ratio: channel.ratio,
            description: translateServerText(
              t,
              channelUsageDescription(channel)
            ),
          }))}
          renderOption={(option, selected) => {
            const channel = props.channels.find(
              (item) => item.group === option.value
            )
            return channel ? (
              <MeowChannelOption channel={channel} selected={selected} />
            ) : null
          }}
          optionClassName={CHANNEL_OPTION_CLASSNAME}
          className='border-border/80 bg-card/70 h-12 w-full rounded-xl px-4 [&>span]:text-sm'
        />
      </div>
      <ToggleGroup
        aria-label={t('Choose a channel')}
        value={[props.value]}
        onValueChange={(values) => {
          if (values[0]) props.onChange(values[0])
        }}
        spacing={3}
        variant='outline'
        className='hidden w-full grid-cols-2 items-stretch sm:grid md:grid-cols-3'
      >
        {props.channels.map((channel) => (
          <ToggleGroupItem
            key={channel.group}
            value={channel.group}
            aria-label={channel.group}
            data-checked={channel.group === props.value}
            className={CHANNEL_OPTION_CLASSNAME}
          >
            <MeowChannelOption
              channel={channel}
              selected={channel.group === props.value}
            />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
