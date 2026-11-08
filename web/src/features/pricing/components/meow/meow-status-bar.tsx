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
import { getSuccessRateDotClass } from '@/features/performance-metrics/lib/format'
import { cn } from '@/lib/utils'

import type { StatusSlot } from '../../lib/meow-catalog'

export interface MeowStatusBarProps {
  slots: StatusSlot[]
  className?: string
}

/** 24 hourly success-rate slots; hours without traffic stay grey. */
export function MeowStatusBar(props: MeowStatusBarProps) {
  return (
    <div
      aria-hidden
      className={cn('flex h-3 items-center gap-px', props.className)}
    >
      {props.slots.map((slot) => (
        <span
          key={slot.ts}
          className={cn(
            'h-full w-[3px] shrink-0 rounded-xs',
            slot.successRate === null
              ? 'bg-muted-foreground/20'
              : getSuccessRateDotClass(slot.successRate)
          )}
        />
      ))}
    </div>
  )
}
