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
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import type { ComponentType } from 'react'
import { useTranslation } from 'react-i18next'

import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'
import { cn } from '@/lib/utils'

import {
  type HomeProvider,
  pickProviderModels,
} from '../../lib/provider-models'

type ProviderCard = {
  id: HomeProvider
  vendor: string
  name: string
  icon: ComponentType<{ size?: number; className?: string }>
  card: string
  glow: string
  iconTile: string
  vendorText: string
  chip: string
  link: string
}

// The pair mirrors the logo's patches on matching frosted glass: Claude has
// the orange glow (top left) and an orange icon tile, GPT the dark glow (top
// right) and a black tile. Dark mode keeps the earlier solid cards.
const GLASS_CARD =
  'border-white/75 bg-white/30 text-meow-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_24px_48px_-30px_rgba(30,27,23,0.3)] dark:text-white dark:shadow-none'
const GLASS_CHIP = 'border-white/80 bg-white/45'

const PROVIDERS: ProviderCard[] = [
  {
    id: 'claude',
    vendor: 'Anthropic',
    name: 'Claude',
    icon: Claude,
    card: `${GLASS_CARD} dark:border-[#4A3020] dark:bg-linear-to-br dark:from-[#3B2416] dark:via-[#2C1E14] dark:to-[#211912]`,
    glow: 'meow-drift-a bg-meow-orange -top-16 -left-16 opacity-45 dark:opacity-40',
    iconTile: 'bg-meow-orange text-meow-ink dark:bg-white/10 dark:text-white',
    vendorText: 'text-meow-accent-text',
    chip: `${GLASS_CHIP} dark:border-white/10 dark:bg-white/[0.07]`,
    link: 'text-meow-accent-text',
  },
  {
    id: 'gpt',
    vendor: 'OpenAI',
    name: 'GPT',
    icon: OpenAI,
    card: `${GLASS_CARD} dark:border-white/10 dark:bg-[#25211C]`,
    glow: 'meow-drift-b bg-meow-ink -top-16 -right-16 opacity-20 dark:top-auto dark:-bottom-20 dark:bg-white dark:opacity-15',
    iconTile: 'bg-meow-ink text-white dark:bg-white/10',
    vendorText: 'text-meow-ink/70 dark:text-[#F2CFA6]',
    chip: `${GLASS_CHIP} dark:border-white/15 dark:bg-white/[0.08]`,
    link: 'text-meow-ink dark:text-[#F2CFA6]',
  },
]

/** The two provider cards: Claude and GPT, with live model names. */
export function MeowModels() {
  const { t } = useTranslation()
  const { models } = usePricingData()

  return (
    <section className='mx-auto flex max-w-6xl flex-col gap-7 px-4 pb-20 sm:px-8'>
      <div className='border-border flex flex-wrap items-end justify-between gap-4 border-t pt-10'>
        <h2 className='text-3xl font-extrabold tracking-[-0.03em] md:text-4xl'>
          {t('Two model families,')}{' '}
          <span className='text-meow-heading'>{t('official channels')}</span>
        </h2>
        <Link
          to='/pricing'
          className='text-primary inline-flex items-center gap-1.5 text-[15px] font-bold'
        >
          {t('All models and prices')}
          <ArrowRight className='size-4' aria-hidden='true' />
        </Link>
      </div>

      <div className='grid grid-cols-1 gap-5 md:grid-cols-2'>
        {PROVIDERS.map((provider) => {
          const names = pickProviderModels(models, provider.id)
          const Icon = provider.icon
          return (
            <div
              key={provider.id}
              className={cn(
                'relative isolate flex min-h-60 flex-col gap-5 overflow-hidden rounded-3xl border px-8 py-7',
                provider.card
              )}
            >
              <div
                aria-hidden='true'
                className={cn(
                  'pointer-events-none absolute -z-10 h-48 w-56 rounded-full blur-[56px]',
                  provider.glow
                )}
              />
              <Icon
                size={120}
                aria-hidden='true'
                className='pointer-events-none absolute -right-4 -bottom-6 -z-10 opacity-[0.08]'
              />
              <div className='flex items-center gap-3'>
                <span
                  className={cn(
                    'flex size-11 items-center justify-center rounded-xl',
                    provider.iconTile
                  )}
                >
                  <Icon size={24} aria-hidden='true' />
                </span>
                <div className='flex flex-col'>
                  <span
                    className={cn(
                      'text-[13px] font-extrabold',
                      provider.vendorText
                    )}
                  >
                    {provider.vendor}
                  </span>
                  <span className='text-3xl leading-tight font-extrabold tracking-[-0.03em]'>
                    {provider.name}
                  </span>
                </div>
              </div>
              {names.length > 0 ? (
                <ul className='flex flex-wrap gap-2'>
                  {names.map((name) => (
                    <li
                      key={name}
                      className={cn(
                        'rounded-[9px] border px-2.5 py-1.5 font-mono text-[13px]',
                        provider.chip
                      )}
                    >
                      {name}
                    </li>
                  ))}
                </ul>
              ) : (
                <p
                  className={cn(
                    'self-start rounded-[9px] border border-dashed px-2.5 py-1.5 text-[13px] opacity-70',
                    provider.chip
                  )}
                >
                  {t('Models coming soon')}
                </p>
              )}
              <Link
                to='/pricing'
                className={cn(
                  'mt-auto inline-flex items-center gap-1.5 text-sm font-bold',
                  provider.link
                )}
              >
                {t('View Pricing')}
                <ArrowRight className='size-4' aria-hidden='true' />
              </Link>
            </div>
          )
        })}
      </div>
    </section>
  )
}
