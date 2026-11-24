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
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PageFooterProvider } from '@/components/layout/components/page-footer'
import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { Route as ContentRiskRoute } from '@/routes/_authenticated/usage-logs/content-risk'
import { useAuthStore } from '@/stores/auth-store'

import { RiskProfileTable } from '../components/risk-profile-table'
import type { RiskProfile } from '../types'

const LIST_URL = '/api/content_safety/risk_profiles'

const watched: RiskProfile = {
  user_id: 7,
  username: 'alice',
  score: 27.5,
  level: 'watch',
  shadow_score: 130.25,
  shadow_level: 'blocked',
  would_block: true,
  blocked: false,
  blocked_at: 0,
  blocked_reason: '',
  trusted: false,
  unsafe_count: 1,
  controversial_count: 3,
  last_event_at: 1795000000,
  updated_at: 1795000000,
}

function mockProfiles(items: RiskProfile[]) {
  return vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { items, total: items.length, page: 1, page_size: 20 },
    },
  })
}

// The table renders its pagination into the page footer slot of the layout.
const footers: HTMLDivElement[] = []

afterEach(() => {
  footers.splice(0).forEach((footer) => footer.remove())
  vi.restoreAllMocks()
  useAuthStore.getState().auth.reset()
})

// Mounts the table under the same route ID and search validation as the app.
async function renderRiskPage(path = '/usage-logs/content-risk') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const footer = document.body.appendChild(document.createElement('div'))
  footers.push(footer)
  const root = createRootRoute()
  const authenticated = createRoute({
    getParentRoute: () => root,
    id: '_authenticated',
  })
  const router = createRouter({
    routeTree: root.addChildren([
      authenticated.addChildren([
        createRoute({
          getParentRoute: () => authenticated,
          path: '/usage-logs/content-risk',
          validateSearch: ContentRiskRoute.options.validateSearch,
          component: RiskProfileTable,
        }),
      ]),
      createRoute({
        getParentRoute: () => root,
        path: '/403',
        component: () => <p>Forbidden page</p>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <PageFooterProvider container={footer}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </PageFooterProvider>
  )
  await act(() => router.load())
  return router
}

describe('risk profile list', () => {
  it('shows each profile returned by the risk profile API as a row', async () => {
    const get = mockProfiles([watched])
    await renderRiskPage()
    const row = await screen.findByRole('row', { name: /alice/ })
    expect(within(row).getByText('Watched')).toBeVisible()
    expect(within(row).getByText('27.5')).toBeVisible()
    expect(within(row).getByText('#7')).toBeVisible()
    expect(get).toHaveBeenCalledWith(LIST_URL, {
      params: { p: 1, page_size: 20, view: 'enforce' },
    })
  })

  it('a blocked account shows its stored block reason in words', async () => {
    const blocked = { ...watched, level: 'blocked', blocked: true }
    mockProfiles([
      { ...blocked, blocked_reason: 'score_threshold' },
      {
        ...blocked,
        user_id: 8,
        username: 'bob',
        blocked_reason: 'zero_tolerance:sexual_minors',
      },
    ])
    await renderRiskPage()
    const byScore = await screen.findByRole('row', { name: /alice/ })
    expect(
      within(byScore).getByText('Score reached the block threshold')
    ).toBeVisible()
    const byCategory = screen.getByRole('row', { name: /bob/ })
    expect(
      within(byCategory).getByText(
        'Zero-tolerance category: Sexual content involving minors'
      )
    ).toBeVisible()
  })

  it('a link with user_id requests only that account and shows it in the User ID filter', async () => {
    const get = mockProfiles([watched])
    await renderRiskPage('/usage-logs/content-risk?user_id=7')
    await screen.findByRole('row', { name: /alice/ })
    expect(get).toHaveBeenCalledWith(LIST_URL, {
      params: { p: 1, page_size: 20, view: 'enforce', user_id: 7 },
    })
    expect(screen.getByRole('textbox', { name: 'User ID' })).toHaveValue('7')
  })

  it('choosing a level requests only that level and keeps it in the URL', async () => {
    const get = mockProfiles([watched])
    const router = await renderRiskPage()
    const user = userEvent.setup()
    await screen.findByRole('row', { name: /alice/ })
    await user.click(screen.getByRole('combobox', { name: 'Level' }))
    await user.click(await screen.findByRole('option', { name: 'Blocked' }))
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith(LIST_URL, {
        params: { p: 1, page_size: 20, view: 'enforce', level: 'blocked' },
      })
    )
    expect(router.state.location.search).toMatchObject({ level: 'blocked' })
  })

  it('choosing Not trusted requests trusted=false', async () => {
    const get = mockProfiles([watched])
    await renderRiskPage()
    const user = userEvent.setup()
    await screen.findByRole('row', { name: /alice/ })
    await user.click(screen.getByRole('combobox', { name: 'Trusted' }))
    await user.click(await screen.findByRole('option', { name: 'Not trusted' }))
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith(LIST_URL, {
        params: { p: 1, page_size: 20, view: 'enforce', trusted: false },
      })
    )
  })

  it('typing a username and pressing Enter requests that username', async () => {
    const get = mockProfiles([watched])
    await renderRiskPage()
    const user = userEvent.setup()
    await screen.findByRole('row', { name: /alice/ })
    await user.type(
      screen.getByRole('textbox', { name: 'Username' }),
      ' alice {Enter}'
    )
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith(LIST_URL, {
        params: { p: 1, page_size: 20, view: 'enforce', username: 'alice' },
      })
    )
  })

  it('a user ID that is not a positive integer is flagged and not requested', async () => {
    const get = mockProfiles([watched])
    await renderRiskPage()
    await screen.findByRole('row', { name: /alice/ })
    const input = screen.getByRole('textbox', { name: 'User ID' })
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(
      await screen.findByText('User ID must be a positive integer')
    ).toBeVisible()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('switching to Shadow requests shadow scores and marks who would be blocked', async () => {
    const get = mockProfiles([watched])
    await renderRiskPage()
    const user = userEvent.setup()
    await screen.findByRole('row', { name: /alice/ })
    await user.click(screen.getByRole('button', { name: 'Shadow' }))
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith(LIST_URL, {
        params: { p: 1, page_size: 20, view: 'shadow' },
      })
    )
    const row = screen.getByRole('row', { name: /alice/ })
    expect(within(row).getByText('130.25')).toBeVisible()
    expect(within(row).getByText('Blocked')).toBeVisible()
    expect(within(row).getByText('Would block')).toBeVisible()
    expect(
      screen.getByRole('columnheader', { name: 'Shadow score' })
    ).toBeVisible()
  })

  it('leaves for /403 and records the lost permission when the API answers 403', async () => {
    useAuthStore.getState().auth.setUser({
      id: 1,
      username: 'admin',
      role: ROLE.ADMIN,
      permissions: { admin_permissions: { audit: { read: true } } },
    })
    vi.spyOn(api, 'get').mockRejectedValue(
      Object.assign(new Error('forbidden'), { response: { status: 403 } })
    )
    const router = await renderRiskPage()
    expect(await screen.findByText('Forbidden page')).toBeVisible()
    expect(router.state.location.pathname).toBe('/403')
    expect(
      useAuthStore.getState().auth.user?.permissions?.admin_permissions?.audit
        ?.read
    ).toBe(false)
  })
})

describe('risk profile row actions', () => {
  async function openRowAction(name: string, profile = watched) {
    const get = mockProfiles([profile])
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: true, message: '' } })
    await renderRiskPage()
    const user = userEvent.setup()
    const row = await screen.findByRole('row', { name: /alice/ })
    await user.click(within(row).getByRole('button', { name: 'Open menu' }))
    await user.click(await screen.findByRole('menuitem', { name }))
    return { get, post, user, dialog: await screen.findByRole('alertdialog') }
  }

  it('confirming the reset posts to the reset endpoint and reloads the list', async () => {
    const action = await openRowAction('Reset score and unblock')
    expect(
      within(action.dialog).getByText('Reset score and unblock?')
    ).toBeVisible()
    await action.user.click(
      within(action.dialog).getByRole('button', {
        name: 'Reset score and unblock',
      })
    )
    await waitFor(() =>
      expect(action.post).toHaveBeenCalledExactlyOnceWith(
        '/api/content_safety/risk_profiles/7/reset'
      )
    )
    await waitFor(() => expect(action.get).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
  })

  it('canceling the reset dialog sends nothing', async () => {
    const action = await openRowAction('Reset score and unblock')
    await action.user.click(
      within(action.dialog).getByRole('button', { name: 'Cancel' })
    )
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
    expect(action.post).not.toHaveBeenCalled()
  })

  it('confirming Trust account posts trusted true for that account', async () => {
    const action = await openRowAction('Trust account')
    await action.user.click(
      within(action.dialog).getByRole('button', { name: 'Trust account' })
    )
    await waitFor(() =>
      expect(action.post).toHaveBeenCalledExactlyOnceWith(
        '/api/content_safety/risk_profiles/7/trust',
        { trusted: true }
      )
    )
    await waitFor(() => expect(action.get).toHaveBeenCalledTimes(2))
  })

  it('confirming Stop trusting on a trusted account posts trusted false', async () => {
    const action = await openRowAction('Stop trusting', {
      ...watched,
      trusted: true,
    })
    await action.user.click(
      within(action.dialog).getByRole('button', { name: 'Stop trusting' })
    )
    await waitFor(() =>
      expect(action.post).toHaveBeenCalledExactlyOnceWith(
        '/api/content_safety/risk_profiles/7/trust',
        { trusted: false }
      )
    )
  })

  it('a refused reset shows the server message and keeps the dialog open', async () => {
    const error = vi.spyOn(toast, 'error').mockImplementation(() => 0)
    const action = await openRowAction('Reset score and unblock')
    action.post.mockResolvedValue({
      data: { success: false, message: 'Permission denied' },
    })
    await action.user.click(
      within(action.dialog).getByRole('button', {
        name: 'Reset score and unblock',
      })
    )
    await waitFor(() => expect(error).toHaveBeenCalledWith('Permission denied'))
    expect(screen.getByRole('alertdialog')).toBeVisible()
    expect(action.get).toHaveBeenCalledTimes(1)
  })
})
