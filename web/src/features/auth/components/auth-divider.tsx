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

import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

type AuthDividerProps = {
  children: ReactNode
  className?: string
}

/**
 * Labeled rule between groups of sign-in methods. The label sits in a gap
 * between two lines instead of on a painted background, so it reads on the
 * translucent auth card in both themes.
 */
export function AuthDivider(props: AuthDividerProps) {
  return (
    <div
      className={cn(
        'text-muted-foreground flex items-center gap-3 text-xs uppercase',
        props.className
      )}
    >
      <Separator className='flex-1' />
      <span className='shrink-0'>{props.children}</span>
      <Separator className='flex-1' />
    </div>
  )
}
