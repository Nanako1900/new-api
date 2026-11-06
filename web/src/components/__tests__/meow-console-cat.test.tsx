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
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { LayoutProvider } from '@/context/layout-provider'

import { MeowConsoleCat } from '../meow-console-cat'

const { location } = vi.hoisted(() => ({ location: { pathname: '/' } }))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useRouterState: (options: {
    select: (state: { location: { pathname: string } }) => unknown
  }) => options.select({ location }),
}))

// The console panel the cat measures: 240px from the left (sidebar), bottom
// edge at 1263px; the width is set per test.
let panel: HTMLElement
let remeasure: () => void
function setPanelWidth(width: number) {
  panel.getBoundingClientRect = () =>
    ({ left: 240, right: 240 + width, bottom: 1263, width }) as DOMRect
}

function renderCat() {
  return render(<MeowConsoleCat />, { wrapper: LayoutProvider })
}

beforeEach(() => {
  panel = document.createElement('main')
  panel.dataset.slot = 'sidebar-inset'
  document.body.append(panel)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        remeasure = callback
      }
      observe() {}
      disconnect() {}
    }
  )
})

afterEach(() => {
  panel.remove()
  vi.unstubAllGlobals()
  document.cookie = 'layout_variant=; max-age=0'
})

test('on /profile with a 2312px panel, the 176px cat lies 12px right of the content column with its belly on the panel edge', () => {
  location.pathname = '/profile'
  setPanelWidth(2312)
  const { container } = renderCat()
  const cat = container.firstElementChild as HTMLElement

  // Column: 1280px centred in the panel, so its right edge is at 2036px.
  expect(cat).toHaveStyle({ left: '2048px', width: '176px' })
  // Belly (65.6% down a 176 x 110.7px drawing) 1px into the 1263px edge.
  expect(Number.parseFloat(cat.style.top)).toBeCloseTo(1191.39, 1)
})

test('when the gutter beside the column only just fits, the cat shrinks to its 112px minimum', () => {
  location.pathname = '/profile'
  setPanelWidth(1576)
  const { container } = renderCat()
  expect(container.firstElementChild).toHaveStyle({ width: '112px' })
})

test('when the gutter is narrower than the minimum cat, no cat is shown', () => {
  location.pathname = '/profile'
  setPanelWidth(1574)
  const { container } = renderCat()
  expect(container).toBeEmptyDOMElement()
})

test('when the panel resizes, the cat is placed again', () => {
  location.pathname = '/profile'
  setPanelWidth(2312)
  const { container } = renderCat()

  setPanelWidth(1576)
  act(() => remeasure())
  expect(container.firstElementChild).toHaveStyle({ width: '112px' })
})

test('on a full-width log page, no cat is shown', () => {
  location.pathname = '/usage-logs/common'
  setPanelWidth(2312)
  const { container } = renderCat()
  expect(container).toBeEmptyDOMElement()
})

test('in the floating layout, whose panel reaches the window bottom, no cat is shown', () => {
  document.cookie = 'layout_variant=floating'
  location.pathname = '/profile'
  setPanelWidth(2312)
  const { container } = renderCat()
  expect(container).toBeEmptyDOMElement()
})
