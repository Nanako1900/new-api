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
import { type ReactNode, useState } from 'react'

import { alignPlaces } from '@/lib/align-places'
import { cn } from '@/lib/utils'

type RollingNumberProps = {
  value: number
  /** Turns the value into its display text, e.g. `formatQuota`. */
  format: (value: number) => string
  className?: string
}

type Roll = {
  /** The value on screen. */
  value: number
  /** The value it last rolled from; null until the value first changes. */
  from: number | null
  /** Counts changes, so every roll remounts its characters and replays. */
  id: number
}

/**
 * A number that rolls to its new value like an odometer: the characters
 * that changed slide in from below when the value grows and from above
 * when it shrinks, while the old ones slide out the other way. The first
 * render and unchanged characters stay still. Styles and the reduced-motion
 * fallback live in meow.css.
 */
export function RollingNumber(props: RollingNumberProps) {
  const [roll, setRoll] = useState<Roll>({
    value: props.value,
    from: null,
    id: 0,
  })
  if (props.value !== roll.value) {
    // Recorded during render (React re-renders before committing), so the
    // first frame that shows the new value already rolls.
    setRoll({ value: props.value, from: roll.value, id: roll.id + 1 })
  }

  const text = props.format(props.value)
  if (roll.from === null) {
    return (
      <span className={cn('whitespace-nowrap tabular-nums', props.className)}>
        {text}
      </span>
    )
  }

  const direction = props.value > roll.from ? 'up' : 'down'
  const cells: ReactNode[] = []
  const pairs = alignPlaces(text, props.format(roll.from))
  for (const [index, [nextChar, previousChar]] of pairs.entries()) {
    if (nextChar === previousChar) {
      cells.push(<span key={index}>{nextChar}</span>)
      continue
    }
    cells.push(
      <span
        key={`${roll.id}-${index}`}
        data-roll={direction}
        className='relative inline-block'
      >
        {/* A zero-width space keeps the line height for a vanished digit. */}
        <span className={`inline-block meow-roll-in-${direction}`}>
          {nextChar || '​'}
        </span>
        <span
          className={`pointer-events-none absolute top-0 left-0 select-none meow-roll-out-${direction}`}
        >
          {previousChar}
        </span>
      </span>
    )
  }

  return (
    <span className={cn('whitespace-nowrap tabular-nums', props.className)}>
      <span className='sr-only'>{text}</span>
      <span aria-hidden='true'>{cells}</span>
    </span>
  )
}
