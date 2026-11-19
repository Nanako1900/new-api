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
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { Toaster, toast } from 'sonner'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'

import { apiKeySchema, type ApiKey } from '../../../types'
import { MeowApiKeys } from '../meow-keys-page'

const listedKey = apiKeySchema.parse({
  id: 7,
  name: 'codex',
  key: 'demo********1234',
  status: 1,
  remain_quota: 100,
  used_quota: 0,
  unlimited_quota: false,
  expired_time: -1,
  created_time: 0,
  accessed_time: 0,
  group: 'CC Max',
  model_limits_enabled: true,
  model_limits: 'gpt-6-sol,gpt-5.6-luna',
})
const groups = {
  'CC Max': { desc: 'Claude Code only', ratio: 1.3 },
  'GPT Pro号池': { desc: 'GPT pool', ratio: 0.22 },
}

const i18n = createInstance()
await i18n.init({
  lng: 'en',
  resources: { en: { translation: {} } },
  initAsync: false,
})
const clients: QueryClient[] = []

/** Serves the list, the key itself and the groups; the key is fresher. */
function mockApi(key: ApiKey, freshRemainQuota: number) {
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === `/api/token/${key.id}`) {
      return {
        data: {
          success: true,
          data: { ...key, remain_quota: freshRemainQuota },
        },
      }
    }
    if (url.startsWith('/api/token/')) {
      return { data: { success: true, data: { items: [key], total: 1 } } }
    }
    if (url === '/api/user/self/groups') {
      return { data: { success: true, data: groups } }
    }
    return { data: { success: true, data: {} } }
  })
  return vi.spyOn(api, 'put')
}

async function renderKeysPage(key: ApiKey) {
  const client = createAppQueryClient()
  client.setDefaultOptions({ queries: { retry: false } })
  client.setQueryData(['status'], {})
  clients.push(client)
  const root = createRootRoute()
  const auth = createRoute({ getParentRoute: () => root, id: '_authenticated' })
  const keysRoute = createRoute({
    getParentRoute: () => auth,
    path: 'keys/',
    component: () => (
      <>
        <MeowApiKeys />
        <Toaster />
      </>
    ),
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([keysRoute])]),
    history: createMemoryHistory({ initialEntries: ['/keys/'] }),
  })
  await router.load()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>
  )
  await screen.findByText(key.name)
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  toast.dismiss()
  localStorage.clear()
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
})

test('a key row shows its group and model limit instead of a models column', async () => {
  mockApi(listedKey, 100)
  await renderKeysPage(listedKey)
  expect(screen.getAllByText('Group')).not.toHaveLength(0)
  expect(screen.queryByText('Models')).not.toBeInTheDocument()
  expect(screen.queryByText('All models')).not.toBeInTheDocument()
  expect(
    screen.getByRole('combobox', { name: 'Change group for codex' })
  ).toHaveTextContent('CC Max')
  expect(screen.getByText('Limited models: 2')).toHaveAttribute(
    'title',
    'gpt-6-sol, gpt-5.6-luna'
  )
})

test('picking another group saves it on the freshly fetched key and shows it in the row', async () => {
  const put = mockApi(listedKey, 40)
  put.mockImplementation(async (_url, data) => ({
    data: { success: true, data: data as ApiKey },
  }))
  const user = userEvent.setup()
  await renderKeysPage(listedKey)
  const picker = screen.getByRole('combobox', {
    name: 'Change group for codex',
  })
  await user.click(picker)
  await user.click(await screen.findByRole('option', { name: /GPT Pro号池/ }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/token/',
      expect.objectContaining({
        id: 7,
        group: 'GPT Pro号池',
        remain_quota: 40,
        model_limits: 'gpt-6-sol,gpt-5.6-luna',
      })
    )
  )
  await screen.findByText('codex now uses GPT Pro号池')
  expect(picker).toHaveTextContent('GPT Pro号池')
  expect(picker).toBeEnabled()
})

test('a refused group change keeps the old group and shows the reason', async () => {
  const put = mockApi(listedKey, 100)
  put.mockResolvedValue({
    data: { success: false, message: 'Group is not available' },
  })
  const user = userEvent.setup()
  await renderKeysPage(listedKey)
  const picker = screen.getByRole('combobox', {
    name: 'Change group for codex',
  })
  await user.click(picker)
  await user.click(await screen.findByRole('option', { name: /GPT Pro号池/ }))
  await screen.findByText('Group is not available')
  expect(picker).toHaveTextContent('CC Max')
})

test('choosing the group a key already has sends nothing', async () => {
  const put = mockApi(listedKey, 100)
  const user = userEvent.setup()
  await renderKeysPage(listedKey)
  await user.click(
    screen.getByRole('combobox', { name: 'Change group for codex' })
  )
  await user.click(await screen.findByRole('option', { name: /CC Max/ }))
  expect(put).not.toHaveBeenCalled()
})

test.each([
  ['CC Max', 'true'],
  ['', 'false'],
  ['retired', 'false'],
])(
  'a row with group "%s" tells the onboarding tour whether it is usable (%s)',
  async (group, picked) => {
    const key = { ...listedKey, group }
    mockApi(key, 100)
    await renderKeysPage(key)
    const picker = screen.getByRole('combobox', {
      name: 'Change group for codex',
    })
    await waitFor(() =>
      expect(picker.closest('[data-tour="key-row-group"]')).toHaveAttribute(
        'data-group-picked',
        picked
      )
    )
  }
)
