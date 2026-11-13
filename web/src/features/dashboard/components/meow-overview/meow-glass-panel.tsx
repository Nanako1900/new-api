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

/**
 * The overview's frosted-glass panel, with two slow glows drifting behind
 * it. Holds the getting-started checklist and, once that is done, the
 * popular models.
 */
export function MeowGlassPanel(props: { children: ReactNode }) {
  return (
    <div className='relative'>
      <div
        aria-hidden='true'
        className='meow-drift-a bg-meow-orange pointer-events-none absolute -top-6 -left-4 h-40 w-60 rounded-full opacity-55 blur-[50px]'
      />
      <div
        aria-hidden='true'
        className='meow-drift-b bg-meow-ink pointer-events-none absolute top-16 right-6 size-44 rounded-full opacity-25 blur-[54px] dark:bg-white dark:opacity-10'
      />
      <div className='relative isolate flex h-full flex-col gap-4 rounded-[22px] border border-white/80 bg-white/55 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_24px_48px_-30px_rgba(30,27,23,0.3)] dark:border-white/10 dark:bg-white/[0.05] dark:shadow-none'>
        {props.children}
      </div>
    </div>
  )
}
