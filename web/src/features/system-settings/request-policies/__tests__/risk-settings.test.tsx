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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { Route as PoliciesRoute } from '@/routes/_authenticated/system-settings/request-policies/$section'

import { RequestPolicies } from '..'
import {
  defaultRequestPolicySettings,
  type RequestPolicySettings,
} from '../defaults'

let settings: RequestPolicySettings
let queryClient: QueryClient

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  settings = {
    ...defaultRequestPolicySettings,
    'content_safety_setting.review_mode': 'enforce',
  }
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  vi.spyOn(api, 'get').mockImplementation(async () => ({
    data: {
      success: true,
      data: Object.entries(settings).map(([key, value]) => ({
        key,
        value: String(value),
      })),
    },
  }))
  vi.spyOn(api, 'patch').mockResolvedValue({
    data: { success: true, data: { options: {} } },
  })
})

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
})

async function renderRiskSection() {
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
          path: '/system-settings/request-policies/$section',
          beforeLoad: PoliciesRoute.options.beforeLoad as () => void,
          component: RequestPolicies,
        }),
      ]),
    ]),
    history: createMemoryHistory({
      initialEntries: ['/system-settings/request-policies/risk'],
    }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await act(() => router.load())
  return screen.findByRole('button', { name: 'Save Changes' })
}

function setNumber(label: string, value: string) {
  fireEvent.change(screen.getByRole('spinbutton', { name: label }), {
    target: { value },
  })
}

it('saving the risk section without edits writes no option', async () => {
  const save = await renderRiskSection()
  await userEvent.click(save)
  await waitFor(() => expect(save).toBeEnabled())
  expect(api.patch).not.toHaveBeenCalled()
})

it('changing the watch threshold writes only that option as a string', async () => {
  const save = await renderRiskSection()
  setNumber('Watch threshold', '30')
  await userEvent.click(save)
  await waitFor(() =>
    expect(api.patch).toHaveBeenCalledExactlyOnceWith(
      '/api/option/request_policy',
      { options: { 'content_safety_setting.risk_watch_threshold': '30' } }
    )
  )
})

it('a restrict threshold equal to the watch threshold blocks the save and explains why', async () => {
  const save = await renderRiskSection()
  setNumber('Restrict threshold', '20')
  await userEvent.click(save)
  expect(
    await screen.findByText('Must be greater than the watch threshold')
  ).toBeVisible()
  expect(
    screen.getByRole('spinbutton', { name: 'Restrict threshold' })
  ).toHaveAttribute('aria-invalid', 'true')
  expect(api.patch).not.toHaveBeenCalled()
})

it('a block threshold below the restrict threshold blocks the save and explains why', async () => {
  const save = await renderRiskSection()
  setNumber('Block threshold', '40')
  await userEvent.click(save)
  expect(
    await screen.findByText('Must be greater than the restrict threshold')
  ).toBeVisible()
  expect(api.patch).not.toHaveBeenCalled()
})

it('a half-life above 8760 hours blocks the save with the allowed range', async () => {
  const save = await renderRiskSection()
  setNumber('Score half-life (hours)', '8761')
  await userEvent.click(save)
  expect(
    await screen.findByText('Enter an integer from 1 to 8,760')
  ).toBeVisible()
  expect(api.patch).not.toHaveBeenCalled()
})

it('adding a zero-tolerance category saves the categories one per line', async () => {
  const user = userEvent.setup()
  const save = await renderRiskSection()
  // The multi-select input is named by its placeholder.
  await user.click(screen.getByRole('combobox', { name: 'Select categories' }))
  await user.click(await screen.findByRole('option', { name: 'Weapons' }))
  await user.click(save)
  await waitFor(() =>
    expect(api.patch).toHaveBeenCalledExactlyOnceWith(
      '/api/option/request_policy',
      {
        options: {
          'content_safety_setting.risk_zero_tolerance_categories':
            'sexual_minors\nweapons',
        },
      }
    )
  )
})

it('turning notifications off writes false', async () => {
  const save = await renderRiskSection()
  await userEvent.click(screen.getByRole('switch', { name: 'Notify admins' }))
  await userEvent.click(save)
  await waitFor(() =>
    expect(api.patch).toHaveBeenCalledExactlyOnceWith(
      '/api/option/request_policy',
      { options: { 'content_safety_setting.risk_notify_enabled': 'false' } }
    )
  )
})

it('in shadow mode the section says that no account is restricted', async () => {
  settings['content_safety_setting.review_mode'] = 'shadow'
  await renderRiskSection()
  expect(
    screen.getByText('Risk levels act only when the AI review mode is Enforce.')
  ).toBeVisible()
  expect(
    screen.getByText(
      'AI review is in shadow mode: a separate shadow score shows who would be blocked, and no account is restricted.'
    )
  ).toBeVisible()
})
