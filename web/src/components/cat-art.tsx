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
import sleepingCatBody from '@/assets/meow/sleeping-cat-body.webp'
import sleepingCatTail from '@/assets/meow/sleeping-cat-tail.webp'
import { cn } from '@/lib/utils'

// Decorative MeowAPI artwork. Every piece is aria-hidden: the cat touches are
// brand flavor only and never carry information on their own.

type ArtProps = {
  className?: string
}

/** Paw print, drawn in `currentColor`. */
export function PawPrint(props: ArtProps) {
  return (
    <svg
      viewBox='0 0 24 24'
      aria-hidden='true'
      className={cn('size-3.5 shrink-0', props.className)}
    >
      <ellipse cx='12' cy='16.5' rx='5.5' ry='4.5' fill='currentColor' />
      <circle cx='4.8' cy='10' r='2.4' fill='currentColor' />
      <circle cx='9.2' cy='5.2' r='2.4' fill='currentColor' />
      <circle cx='14.8' cy='5.2' r='2.4' fill='currentColor' />
      <circle cx='19.2' cy='10' r='2.4' fill='currentColor' />
    </svg>
  )
}

/**
 * The logo's eyes as a small badge: one black, one white with a black ring.
 */
export function CatEyes(props: ArtProps) {
  return (
    <span
      aria-hidden='true'
      className={cn('inline-flex shrink-0 gap-1', props.className)}
    >
      <span className='bg-meow-ink h-[11px] w-[9px] rounded-full dark:bg-white' />
      <span className='border-meow-ink h-[11px] w-[9px] rounded-full border-[2.5px] bg-white dark:border-white dark:bg-transparent' />
    </span>
  )
}

/**
 * The calico cat asleep on a ledge, its tail hanging over the front edge
 * and swaying (styles in meow.css). Two hand-drawn layers: the tail sits
 * behind the body so its root stays hidden while it swings.
 *
 * 150px wide by default (pass a width class to resize; the height follows).
 * The belly line is 34.4% of the height above the bottom, so to lay the cat
 * on an element use `absolute bottom-full translate-y-[34.4%]` inside it.
 */
export function SleepingCat(props: ArtProps) {
  return (
    <span
      aria-hidden='true'
      className={cn(
        'pointer-events-none relative block w-[150px] shrink-0 select-none',
        props.className
      )}
    >
      <img
        src={sleepingCatTail}
        alt=''
        draggable={false}
        className='meow-cat-tail absolute inset-0 size-full'
      />
      <img
        src={sleepingCatBody}
        alt=''
        width={450}
        height={283}
        draggable={false}
        className='relative block h-auto w-full'
      />
    </span>
  )
}
