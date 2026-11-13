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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { ThemeProvider } from '@/context/theme-provider'
import { api } from '@/lib/api'

import { Home } from '../index'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

function renderHome() {
  // Render the built-in landing page and configured navigation; the remaining
  // endpoints fail, which the landing sections treat as "no data".
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/home_page_content') {
      return { data: { success: true, data: '' } }
    }
    if (url === '/api/status') {
      return {
        data: {
          success: true,
          data: {
            docs_link: 'https://docs.example.com/start',
            HeaderNavModules: {
              rankings: { enabled: true, requireAuth: false },
            },
          },
        },
      }
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

test('home navigation links to model prices and the beginner guide and omits rankings even when configured', async () => {
  const user = userEvent.setup()
  renderHome()
  await screen.findByRole('heading', { level: 1 })

  expect(screen.queryAllByRole('link', { name: 'Rankings' })).toHaveLength(0)
  await user.click(
    screen.getByRole('button', { name: 'Toggle navigation menu' })
  )

  await waitFor(() => {
    const pricingLinks = screen.getAllByRole('link', { name: 'Model prices' })
    const guideLinks = screen.getAllByRole('link', { name: 'Beginner guide' })
    // Both the desktop header and the expanded mobile menu use these links.
    expect(pricingLinks).toHaveLength(2)
    expect(guideLinks).toHaveLength(2)
    for (const link of pricingLinks) {
      expect(link).toHaveAttribute('href', '/pricing')
    }
    for (const link of guideLinks) {
      expect(link).toHaveAttribute('href', 'https://docs.example.com/start')
      expect(link).toHaveAttribute('target', '_blank')
    }
  })
})
