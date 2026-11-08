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
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useSystemConfigStore } from '@/stores/system-config-store'

import { AuthLayout } from '../auth-layout'
import { AuthHeader } from '../components/auth-header'

const initialSystemConfig = useSystemConfigStore.getState()

async function renderLayout() {
  const client = new QueryClient()
  const route = createRootRoute({
    component: () => (
      <QueryClientProvider client={client}>
        <AuthLayout>
          <AuthHeader title='Sign in' />
          <form aria-label='Sign-in form' />
        </AuthLayout>
      </QueryClientProvider>
    ),
  })
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(<RouterProvider router={router} />)
}

beforeEach(() => {
  useSystemConfigStore.setState({
    loading: false,
    config: { ...initialSystemConfig.config, systemName: 'MeowAPI' },
  })
})

afterEach(() => {
  useSystemConfigStore.setState(initialSystemConfig, true)
})

describe('auth split layout', () => {
  it('puts the page title and the form inside the main landmark', async () => {
    await renderLayout()
    const main = await screen.findByRole('main')

    expect(
      within(main).getByRole('heading', { level: 1, name: 'Sign in' })
    ).toBeInTheDocument()
    expect(
      within(main).getByRole('form', { name: 'Sign-in form' })
    ).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('wraps the page content in the glass card the theme styles', async () => {
    await renderLayout()
    const main = await screen.findByRole('main')

    const card = main.querySelector("[data-slot='auth-card']")
    expect(card).toContainElement(screen.getByRole('form'))
  })

  it('shows the brand panel with the site name and three selling points', async () => {
    await renderLayout()
    const panel = await screen.findByRole('complementary')

    expect(
      within(panel).getByRole('link', { name: 'MeowAPI' })
    ).toHaveAttribute('href', '/')
    expect(
      within(panel)
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    ).toEqual(['Official channels', 'Pay as you go', 'Every call itemized'])
  })

  it('keeps the brand panel art out of the accessibility tree', async () => {
    await renderLayout()
    const panel = await screen.findByRole('complementary')

    expect(within(panel).queryAllByRole('img')).toHaveLength(0)
    expect(within(panel).queryAllByRole('heading')).toHaveLength(0)
    const drawings = panel.querySelectorAll('svg')
    expect(drawings.length).toBeGreaterThan(0)
    for (const drawing of drawings) {
      expect(drawing.closest("[aria-hidden='true']")).not.toBeNull()
    }
  })

  it('repeats the brand link above the form for small screens', async () => {
    await renderLayout()
    const banner = await screen.findByRole('banner')

    expect(
      within(banner).getByRole('link', { name: 'MeowAPI' })
    ).toHaveAttribute('href', '/')
  })
})
