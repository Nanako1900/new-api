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

import { PublicLayout } from '@/components/layout'
import { PageTransition } from '@/components/page-transition'

import { MeowPricingCatalog } from './meow-pricing-catalog'

// MeowAPI glow: calico orange, warm grey and caramel.
const GLOW_BACKGROUND = [
  'radial-gradient(ellipse 60% 50% at 20% 20%, color-mix(in oklch, var(--primary) 80%, transparent) 0%, transparent 70%)',
  'radial-gradient(ellipse 50% 40% at 80% 15%, color-mix(in oklch, var(--chart-4) 60%, transparent) 0%, transparent 70%)',
  'radial-gradient(ellipse 40% 35% at 50% 70%, color-mix(in oklch, var(--chart-5) 40%, transparent) 0%, transparent 70%)',
].join(', ')
const GLOW_MASK = 'linear-gradient(to bottom, black 40%, transparent 100%)'

/** `/pricing`: the Claude and GPT price list inside the public layout. */
export function MeowPricing() {
  return (
    <PublicLayout showMainContainer={false}>
      <main className='relative'>
        <div
          aria-hidden
          className='pointer-events-none absolute inset-x-0 top-0 h-[600px] opacity-20 dark:opacity-[0.10]'
          style={{
            background: GLOW_BACKGROUND,
            maskImage: GLOW_MASK,
            WebkitMaskImage: GLOW_MASK,
          }}
        />
        <PageTransition className='relative mx-auto w-full px-3 pt-16 pb-8 sm:px-6 sm:pt-20 sm:pb-10 xl:px-8'>
          <MeowPricingCatalog />
        </PageTransition>
      </main>
    </PublicLayout>
  )
}
