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
import { useRouterState } from '@tanstack/react-router'
import { useLayoutEffect, useState } from 'react'

import { SleepingCat } from '@/components/cat-art'
import { useLayout } from '@/context/layout-provider'

/**
 * Console pages that get the cat, with the max width of each page's centred
 * content column (the cat lies just right of it). Log tables and admin pages
 * fill the panel, so they are left out.
 */
const CAT_PAGES: Record<string, number> = {
  '/dashboard/overview': 1440,
  '/dashboard/models': 1280,
  '/keys': 1440,
  '/playground': 896,
  '/wallet': 1280,
  '/profile': 1280,
  '/security': 1280,
}

/** At this width the hanging tail stays clear of the window's bottom edge. */
const CAT_MAX_WIDTH = 176
const CAT_MIN_WIDTH = 112
/** Height / width of the SleepingCat drawing. */
const CAT_ASPECT = 283 / 450
/** The belly line, as a share of the drawing's height from the top. */
const CAT_BELLY = 0.656
/** Horizontal padding of the console scroll area, each side. */
const PANEL_PADDING = 32
const GAP_TO_COLUMN = 12
const GAP_TO_PANEL_EDGE = 24

type PanelBox = { left: number; right: number; bottom: number; width: number }

/**
 * MeowAPI: the sleeping cat lying on the console panel's bottom edge, beside
 * the content, its tail hanging below the panel. Wide screens only — it
 * shows when there is room between the content column and the panel edge.
 */
export function MeowConsoleCat() {
  const pathname = useRouterState({
    // The page on screen, not state.location: that switches as soon as a
    // navigation starts, while the old page stays up until the next route's
    // code has loaded.
    select: (state) => (state.resolvedLocation ?? state.location).pathname,
  })
  // Only the inset layout ends the panel above the window bottom (meow.css),
  // so only there is there an edge to lie on.
  const { variant } = useLayout()
  const columnMaxWidth = variant === 'inset' ? CAT_PAGES[pathname] : undefined
  const [panel, setPanel] = useState<PanelBox | null>(null)

  useLayoutEffect(() => {
    if (!columnMaxWidth) return
    // The console panel (SidebarInset). The cat lives outside it because the
    // panel clips its children and the tail hangs below the panel's edge.
    const main = document.querySelector<HTMLElement>(
      'main[data-slot="sidebar-inset"]'
    )
    if (!main) return
    const measure = () => {
      const rect = main.getBoundingClientRect()
      setPanel({
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
      })
    }
    // Measure before paint: `panel` may still hold an earlier page's box.
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(main)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [columnMaxWidth])

  if (!columnMaxWidth || !panel) return null

  const column = Math.min(columnMaxWidth, panel.width - 2 * PANEL_PADDING)
  const columnRight = panel.left + panel.width / 2 + column / 2
  const width = Math.min(
    CAT_MAX_WIDTH,
    panel.right - columnRight - GAP_TO_COLUMN - GAP_TO_PANEL_EDGE
  )
  if (width < CAT_MIN_WIDTH) return null

  return (
    <div
      className='pointer-events-none fixed z-10'
      style={{
        left: columnRight + GAP_TO_COLUMN,
        // Belly 1px into the panel edge, so it rests on it.
        top: panel.bottom + 1 - width * CAT_ASPECT * CAT_BELLY,
        width,
      }}
    >
      <SleepingCat className='w-full' />
    </div>
  )
}
