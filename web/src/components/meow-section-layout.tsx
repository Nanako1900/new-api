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
import {
  Children,
  isValidElement,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'

import { Main } from '@/components/layout'
import { PageFooterProvider } from '@/components/layout/components/page-footer'
import { cn } from '@/lib/utils'

type SlotProps = { children?: ReactNode }

function MeowSectionLayoutTitle(_props: SlotProps) {
  return null
}
MeowSectionLayoutTitle.displayName = 'MeowSectionLayout.Title'
function MeowSectionLayoutActions(_props: SlotProps) {
  return null
}
MeowSectionLayoutActions.displayName = 'MeowSectionLayout.Actions'
function MeowSectionLayoutContent(_props: SlotProps) {
  return null
}
MeowSectionLayoutContent.displayName = 'MeowSectionLayout.Content'
function MeowSectionLayoutBreadcrumb(_props: SlotProps) {
  return null
}
MeowSectionLayoutBreadcrumb.displayName = 'MeowSectionLayout.Breadcrumb'

/** Slot a child is for; matched by name too, so hot reloads keep working. */
function slotOf(type: unknown): string | null {
  if (typeof type !== 'function') return null
  const name = (type as { displayName?: string }).displayName ?? ''
  return name.startsWith('MeowSectionLayout.') ? name.slice(18) : null
}

type MeowSectionLayoutProps = {
  children: ReactNode
  fixedContent?: boolean
  stackActionsOnMobile?: boolean
}

/**
 * Drop-in for `SectionPageLayout` with the MeowAPI console look: a large
 * title, content centred at the console width, and the same slots
 * (Title, Actions, Content, Breadcrumb) and page footer for pagination.
 */
export function MeowSectionLayout(props: MeowSectionLayoutProps) {
  const [footer, setFooter] = useState<HTMLDivElement | null>(null)

  let title: ReactNode = null
  let actions: ReactNode = null
  let content: ReactNode = null
  let breadcrumb: ReactNode = null
  Children.forEach(props.children, (node) => {
    if (!isValidElement(node)) return
    const child = node as ReactElement<SlotProps>
    const slot = slotOf(child.type)
    if (slot === 'Title') title = child.props.children
    else if (slot === 'Actions') actions = child.props.children
    else if (slot === 'Content') content = child.props.children
    else if (slot === 'Breadcrumb') breadcrumb = child.props.children
  })

  // Table pages (fixedContent) use the full width so wide tables don't
  // scroll sideways; other pages stay at the console width.
  const width = props.fixedContent ? 'max-w-none' : 'max-w-7xl'

  const header = (
    <header className={cn('mx-auto flex w-full flex-col gap-3', width)}>
      {breadcrumb != null && <div>{breadcrumb}</div>}
      <div className='flex flex-wrap items-center justify-between gap-4'>
        <h1
          className={cn(
            'min-w-0 truncate text-2xl font-extrabold tracking-[-0.03em] sm:text-[1.75rem]',
            props.stackActionsOnMobile && 'max-sm:basis-full'
          )}
        >
          {title}
        </h1>
        {actions != null && (
          <div className='flex max-w-full flex-wrap items-center gap-2'>
            {actions}
          </div>
        )}
      </div>
    </header>
  )

  return (
    <PageFooterProvider container={footer}>
      <Main>
        {props.fixedContent ? (
          <>
            <div className='shrink-0 px-4 pt-6 pb-4 sm:px-6 sm:pt-8'>
              {header}
            </div>
            <div className='min-h-0 flex-1 overflow-hidden px-3 pb-3 sm:px-6 sm:pb-4'>
              <div
                data-meow-page=''
                className={cn('mx-auto h-full w-full', width)}
              >
                {content}
              </div>
            </div>
          </>
        ) : (
          <div className='min-h-0 flex-1 overflow-auto px-4 pt-6 pb-8 sm:px-8 sm:pt-8'>
            {header}
            <div data-meow-page='' className='mx-auto mt-5 w-full max-w-7xl'>
              {content}
            </div>
          </div>
        )}
        <div
          ref={setFooter}
          className='bg-background shrink-0 border-t px-4 py-2.5 empty:hidden sm:px-8'
        />
      </Main>
    </PageFooterProvider>
  )
}

MeowSectionLayout.Title = MeowSectionLayoutTitle
MeowSectionLayout.Actions = MeowSectionLayoutActions
MeowSectionLayout.Content = MeowSectionLayoutContent
MeowSectionLayout.Breadcrumb = MeowSectionLayoutBreadcrumb
