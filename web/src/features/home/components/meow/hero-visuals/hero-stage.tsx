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
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/** Frosted glass over the calico glows, shared by every hero visual. */
export const HERO_GLASS =
  'border border-white/80 bg-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_30px_60px_-30px_rgba(30,27,23,0.35)] backdrop-blur-xl backdrop-saturate-125 dark:border-white/10 dark:bg-white/[0.06] dark:shadow-none'

type HeroStageProps = {
  className?: string
  /**
   * Describes a purely illustrative visual to assistive tech; its contents
   * are then presentational. Omit for visuals with their own controls.
   */
  label?: string
  children: ReactNode
}

/**
 * The hero's right column: the blurred orange glow (top left) and dark glow
 * (right) sit where the logo's calico patches are, behind the visual.
 */
export function HeroStage(props: HeroStageProps) {
  return (
    <div
      className={cn('relative', props.className)}
      role={props.label ? 'img' : undefined}
      aria-label={props.label}
    >
      <div
        aria-hidden='true'
        className='meow-drift-a bg-meow-orange pointer-events-none absolute -top-16 -left-14 h-60 w-72 rounded-full opacity-75 blur-[60px]'
      />
      <div
        aria-hidden='true'
        className='meow-drift-b bg-meow-ink pointer-events-none absolute top-24 -right-16 size-56 rounded-full opacity-55 blur-[64px] dark:bg-white dark:opacity-20'
      />
      {props.children}
    </div>
  )
}
