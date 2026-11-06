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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { ThemeProvider } from '@/context/theme-provider'
import { api } from '@/lib/api'

import { Home } from '../index'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

function renderHome() {
  // No custom home page content, so the built-in landing page renders; every
  // other endpoint fails, which the landing sections treat as "no data".
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/home_page_content') {
      return { data: { success: true, data: '' } }
    }
    return { data: { success: false, message: 'unavailable' } }
  })
  const root = createRootRoute()
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: Home,
  })
  const router = createRouter({
    routeTree: root.addChildren([home]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  )
}

test('the built-in landing page keeps its sections in the main landmark and the footer outside it', async () => {
  renderHome()

  const heading = await screen.findByRole('heading', { level: 1 })

  const main = screen.getByRole('main')
  expect(main).toContainElement(heading)
  expect(within(main).queryByRole('contentinfo')).not.toBeInTheDocument()
})
