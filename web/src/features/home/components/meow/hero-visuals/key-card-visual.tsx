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
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CatEyes } from '@/components/cat-art'
import { formatLatency } from '@/features/performance-metrics/lib/format'
import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'
import { useStatus } from '@/hooks/use-status'
import { toIntlLocale } from '@/i18n/languages'
import { DEFAULT_SYSTEM_NAME } from '@/lib/constants'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import { buildDemoCalls, visibleDemoCalls } from '../../../lib/demo-calls'
import {
  pickProviderModels,
  type HomeProvider,
} from '../../../lib/provider-models'
import { HERO_GLASS, HeroStage } from './hero-stage'

const VISIBLE_ROWS = 4
const ARRIVAL_INTERVAL_MS = 2600

const PROVIDER_ICON = { claude: Claude, gpt: OpenAI } as const

const PROVIDER_TILE: Record<HomeProvider, string> = {
  claude: 'bg-meow-orange text-meow-ink',
  gpt: 'bg-meow-ink text-white dark:bg-white/15',
}

type KeyCardProps = {
  systemName: string
}

/**
 * The API key as a premium card: ink face with the logo's orange and white
 * patches, an EMV-style chip, a masked key, and the two providers where a
 * card network's logo would sit. Sizes follow the card's own width.
 */
function KeyCard(props: KeyCardProps) {
  const { t } = useTranslation()

  return (
    <div className='group/card @container relative'>
      <div className='relative aspect-[1.586/1] w-full -rotate-[4deg] overflow-hidden rounded-[clamp(14px,6cqw,22px)] bg-[#1e1b17] text-[#f3efe8] shadow-[0_40px_60px_-28px_rgba(30,27,23,0.7),inset_0_1px_0_rgba(255,255,255,0.14)] ring-1 ring-white/10 transition-transform duration-500 ease-out motion-safe:group-hover/card:-translate-y-1 motion-safe:group-hover/card:-rotate-[1.5deg] dark:bg-[#26221d]'>
        <span className='bg-meow-orange absolute -top-[38%] -right-[12%] h-[78%] w-[48%] rotate-[18deg] rounded-[46%_54%_42%_58%]' />
        <span className='absolute -right-[8%] -bottom-[38%] h-[66%] w-[40%] -rotate-[12deg] rounded-[58%_42%_50%_50%] bg-[#f3efe8]' />
        <span className='meow-card-sheen absolute inset-0' />

        <div className='relative flex h-full flex-col justify-between p-[7cqw]'>
          <div className='flex items-center gap-[2.4cqw]'>
            <CatEyes onInk />
            <span className='truncate text-[clamp(11px,4.6cqw,17px)] font-extrabold tracking-[-0.01em]'>
              {props.systemName}
            </span>
          </div>

          <span className='relative block h-[9cqw] w-[12.5cqw] overflow-hidden rounded-[1.8cqw] bg-linear-to-br from-[#f6d9b6] via-[#e2ad78] to-[#b9773f] shadow-[inset_0_0_0_1px_rgba(30,27,23,0.25)]'>
            <span className='absolute inset-y-0 left-1/3 w-px bg-[#1e1b17]/25' />
            <span className='absolute inset-y-0 right-1/3 w-px bg-[#1e1b17]/25' />
            <span className='absolute inset-x-0 top-1/2 h-px bg-[#1e1b17]/25' />
          </span>

          <span className='font-mono text-[clamp(11px,4.8cqw,17px)] tracking-[0.1em] whitespace-nowrap'>
            sk-•••• •••• •••• 7f3a
          </span>

          <div className='flex items-end justify-between gap-3'>
            <span className='flex min-w-0 flex-col gap-[0.6cqw]'>
              <span className='text-[clamp(8px,2.7cqw,10px)] font-bold tracking-[0.18em] text-[#f3efe8]/55 uppercase'>
                {t('Billing')}
              </span>
              <span className='truncate text-[clamp(11px,4.2cqw,15px)] font-bold'>
                {t('Pay as you go')}
              </span>
            </span>
            <span className='flex shrink-0'>
              <span className='bg-meow-orange text-meow-ink flex size-[clamp(26px,11cqw,38px)] items-center justify-center rounded-full ring-2 ring-[#f3efe8]'>
                <Claude size={18} />
              </span>
              <span className='-ml-[3cqw] flex size-[clamp(26px,11cqw,38px)] items-center justify-center rounded-full bg-[#1e1b17] text-white ring-2 ring-[#f3efe8]'>
                <OpenAI size={18} />
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

type KeyCardVisualProps = {
  className?: string
}

/**
 * One key, pay as you go, every call itemized: the key card in front of a
 * call log where example calls arrive one by one. Rows are named after the
 * site's own Claude and GPT models.
 */
export function KeyCardVisual(props: KeyCardVisualProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const reduceMotion = useReducedMotion()
  const { status } = useStatus()
  const { models } = usePricingData()
  const [head, setHead] = useState(VISIBLE_ROWS - 1)

  const calls = useMemo(
    () =>
      buildDemoCalls({
        claude: pickProviderModels(models, 'claude'),
        gpt: pickProviderModels(models, 'gpt'),
      }),
    [models]
  )

  useEffect(() => {
    if (reduceMotion) return
    const timer = window.setInterval(
      () => setHead((value) => value + 1),
      ARRIVAL_INTERVAL_MS
    )
    return () => window.clearInterval(timer)
  }, [reduceMotion])

  const systemName =
    typeof status?.system_name === 'string' && status.system_name.trim()
      ? status.system_name.trim()
      : DEFAULT_SYSTEM_NAME
  const rows = visibleDemoCalls(calls, head, VISIBLE_ROWS)

  return (
    <HeroStage
      className={props.className}
      label={t(
        'An API key card for Claude and GPT in front of a call log listing each call'
      )}
    >
      <div className='relative mx-auto w-full max-w-[34rem]'>
        <div
          className={cn(
            'relative ml-auto w-[90%] overflow-hidden rounded-[22px]',
            HERO_GLASS
          )}
        >
          <div className='flex items-center gap-2.5 border-b border-black/5 px-5 py-3.5 dark:border-white/10'>
            <span className='relative flex size-2'>
              <span className='bg-success absolute inline-flex size-full rounded-full opacity-60 motion-safe:animate-ping' />
              <span className='bg-success relative inline-flex size-2 rounded-full' />
            </span>
            <span className='text-sm font-extrabold'>{t('Call log')}</span>
            <span className='text-muted-foreground ml-auto rounded-full border border-black/10 px-2 py-0.5 text-[11px] font-bold dark:border-white/15'>
              {t('Example')}
            </span>
          </div>

          <ul className='relative flex flex-col gap-0.5 px-2.5 pt-2'>
            <AnimatePresence initial={false} mode='popLayout'>
              {rows.map((row) => {
                const Icon = PROVIDER_ICON[row.provider]
                const isNewest = row.seq === head
                return (
                  <motion.li
                    key={row.seq}
                    layout={!reduceMotion}
                    initial={reduceMotion ? false : { opacity: 0, y: -14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={
                      reduceMotion
                        ? undefined
                        : { opacity: 0, transition: { duration: 0.18 } }
                    }
                    transition={{ type: 'spring', stiffness: 380, damping: 34 }}
                    className={cn(
                      'flex items-center gap-3 rounded-[14px] px-2.5 py-2.5 transition-colors duration-700',
                      isNewest && 'bg-primary/10'
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-[10px]',
                        PROVIDER_TILE[row.provider]
                      )}
                    >
                      <Icon size={16} />
                    </span>
                    <span className='flex min-w-0 flex-col'>
                      <span className='truncate font-mono text-[12.5px] font-semibold'>
                        {row.model}
                      </span>
                      <span className='text-muted-foreground text-[11px] tabular-nums'>
                        {t('{{tokens}} tokens', {
                          tokens: formatNumber(row.tokens, locale),
                        })}
                      </span>
                    </span>
                    <span className='ml-auto flex items-center gap-2 font-mono text-[12px] font-semibold tabular-nums'>
                      <span className='bg-success size-1.5 rounded-full' />
                      {formatLatency(row.latencyMs)}
                    </span>
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>

          {/* Room for the key card, which overlaps this corner. */}
          <div className='flex justify-end px-5 pt-3 pb-[25%]'>
            <span className='text-muted-foreground max-w-[32%] text-right text-xs leading-snug font-semibold'>
              {t('Every call itemized')}
            </span>
          </div>
        </div>

        <div className='relative z-10 -mt-[23%] ml-[1%] w-[64%] max-w-[22rem]'>
          <KeyCard systemName={systemName} />
        </div>
      </div>
    </HeroStage>
  )
}
