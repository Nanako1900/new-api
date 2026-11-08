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
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { type UserPermissions, useAuthStore } from '@/stores/auth-store'

import { useSidebarView } from '../use-sidebar-view'

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: [] },
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

/** Each entry as "group id: title", in sidebar order. */
function SidebarEntries() {
  const { navGroups } = useSidebarView()
  return (
    <ul aria-label='Sidebar'>
      {navGroups.flatMap((group) =>
        group.items.map((item) => (
          <li
            key={`${group.id}-${item.title}`}
          >{`${group.id}: ${item.title}`}</li>
        ))
      )}
    </ul>
  )
}

async function sidebarEntries(
  role: number,
  permissions?: UserPermissions
): Promise<string[]> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['status'], { SidebarModulesAdmin: '' })
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'alice', role, permissions })
  const router = createRouter({
    routeTree: createRootRoute({ component: SidebarEntries }),
    history: createMemoryHistory({ initialEntries: ['/dashboard/overview'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  const list = await screen.findByRole('list', { name: 'Sidebar' })
  return [...list.querySelectorAll('li')].map((item) => item.textContent ?? '')
}

const titlesOf = (entries: string[]) =>
  entries.map((entry) => entry.slice(entry.indexOf(': ') + 2))

test('regular users do not see Chat or Task Logs', async () => {
  const titles = titlesOf(await sidebarEntries(ROLE.USER))
  expect(titles).not.toContain('Chat')
  expect(titles).not.toContain('Task Logs')
  expect(titles).toEqual(
    expect.arrayContaining([
      'Playground',
      'Overview',
      'Dashboard',
      'API Keys',
      'Usage Logs',
      'Audit Logs',
      'Wallet',
    ])
  )
})

test('regular users keep Dashboard in the General group', async () => {
  const entries = await sidebarEntries(ROLE.USER)
  expect(entries).toContain('general: Dashboard')
})

test('admins find Task Logs and Chat at the top of the Admin group', async () => {
  const entries = await sidebarEntries(ROLE.ADMIN)
  const admin = entries.filter((entry) => entry.startsWith('admin: '))
  expect(admin.slice(0, 2)).toEqual(['admin: Task Logs', 'admin: Chat'])
  expect(entries).not.toContain('general: Task Logs')
  expect(entries).not.toContain('chat: Chat')
})

test('admins without the audit read permission do not see Content Safety Logs', async () => {
  const titles = titlesOf(await sidebarEntries(ROLE.ADMIN))
  expect(titles).not.toContain('Content Safety Logs')
})

test('admins with the audit read permission find Content Safety Logs in the Admin group', async () => {
  const entries = await sidebarEntries(ROLE.ADMIN, {
    admin_permissions: { audit: { read: true } },
  })
  expect(entries).toContain('admin: Content Safety Logs')
})
