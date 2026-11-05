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
