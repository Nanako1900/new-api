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
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { useStatus } from '@/hooks/use-status'
import { useSystemConfig } from '@/hooks/use-system-config'
import { api } from '@/lib/api'
import {
  getModuleAccessForGuard,
  type HeaderNavModule,
} from '@/lib/nav-modules'
import {
  STATUS_QUERY_KEY,
  ensureStatus,
  initializeSystemLogo,
  statusQueryOptions,
} from '@/lib/status-query'
import { useSystemConfigStore } from '@/stores/system-config-store'

/**
 * Guards the deduplication contract of the shared `['status']` query: several
 * independent consumers asking for status must cost one `/api/status` request.
 */

type ApiMethod = (url: string) => Promise<{ data: unknown }>
type MockableApi = { get: ApiMethod }

const apiClient = api as unknown as MockableApi
const originalGet = apiClient.get

let statusRequests: string[] = []
const queryClients: QueryClient[] = []

/** Count `/api/status` calls at the network boundary and serve `system_name`. */
function stubStatusEndpoint(systemName: string): void {
  apiClient.get = async (url) => {
    if (url !== '/api/status') throw new Error(`Unexpected GET ${url}`)
    statusRequests.push(url)
    return { data: { success: true, data: { system_name: systemName } } }
  }
}

function createQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClients.push(queryClient)
  return queryClient
}

function wrapper(queryClient: QueryClient) {
  return function QueryWrapper(props: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {props.children}
      </QueryClientProvider>
    )
  }
}

beforeEach(() => {
  statusRequests = []
  window.localStorage.clear()
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document
    .querySelectorAll('link[rel~="icon"]')
    .forEach((link) => link.remove())
  queryClients.splice(0).forEach((client) => client.clear())
  apiClient.get = originalGet
  window.localStorage.clear()
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
})

describe('shared status query deduplication', () => {
  test.each(['cold', 'stale'] as const)(
    'deduplicates %s cache requests across guards and hook consumers',
    async (cacheState) => {
      const queryClient = createQueryClient()
      if (cacheState === 'stale') {
        queryClient.setQueryData(
          STATUS_QUERY_KEY,
          {
            system_name: 'old',
            HeaderNavModules: { pricing: false, rankings: false },
          },
          { updatedAt: Date.now() - 600_000 }
        )
      }
      const status = {
        system_name: 'shared',
        HeaderNavModules: {
          pricing: { enabled: true, requireAuth: true },
          rankings: { enabled: true, requireAuth: false },
        },
      }
      let resolveStatus!: (value: { data: unknown }) => void
      const response = new Promise<{ data: unknown }>((resolve) => {
        resolveStatus = resolve
      })
      apiClient.get = (url) => {
        statusRequests.push(url)
        return response
      }
      let guardsResolved = false
      const guards = Promise.all([
        getModuleAccessForGuard(queryClient, 'pricing'),
        getModuleAccessForGuard(queryClient, 'rankings'),
      ]).then((result) => {
        guardsResolved = true
        return result
      })
      const hook = renderHook(() => useStatus(), {
        wrapper: wrapper(queryClient),
      })
      await waitFor(() => expect(statusRequests).toEqual(['/api/status']))
      expect(guardsResolved).toBe(false)
      resolveStatus({ data: { success: true, data: status } })
      expect(await guards).toEqual([
        { enabled: true, requireAuth: true },
        { enabled: true, requireAuth: false },
      ])
      await waitFor(() =>
        expect(hook.result.current.status?.system_name).toBe('shared')
      )
      expect(statusRequests).toHaveLength(1)
    }
  )

  test('resolves a later consumer from the warm cache without a second request', async () => {
    stubStatusEndpoint('warm')
    const queryClient = createQueryClient()

    await ensureStatus(queryClient)
    const second = await ensureStatus(queryClient)

    expect(second?.system_name).toBe('warm')
    expect(statusRequests).toHaveLength(1)
  })

  test('returns a stale entry immediately and refreshes it in the background', async () => {
    stubStatusEndpoint('refreshed')
    const queryClient = createQueryClient()
    const staleTime = statusQueryOptions.staleTime as number
    queryClient.setQueryData(
      STATUS_QUERY_KEY,
      { system_name: 'stale' },
      {
        updatedAt: Date.now() - staleTime - 1,
      }
    )

    const resolved = await ensureStatus(queryClient)

    expect(resolved?.system_name).toBe('stale')
    await waitFor(() => {
      expect(
        queryClient.getQueryData<Record<string, unknown>>(STATUS_QUERY_KEY)
          ?.system_name
      ).toBe('refreshed')
    })
    expect(statusRequests).toHaveLength(1)
  })
})

describe('module guard status freshness', () => {
  test.each([
    {
      module: 'pricing',
      before: { enabled: false, requireAuth: false },
      after: { enabled: true, requireAuth: false },
    },
    {
      module: 'rankings',
      before: { enabled: true, requireAuth: false },
      after: { enabled: false, requireAuth: false },
    },
    {
      module: 'pricing',
      before: { enabled: true, requireAuth: false },
      after: { enabled: true, requireAuth: true },
    },
    {
      module: 'rankings',
      before: { enabled: true, requireAuth: true },
      after: { enabled: true, requireAuth: false },
    },
  ])('uses refreshed $module access: $before -> $after', async (scenario) => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(
      STATUS_QUERY_KEY,
      { HeaderNavModules: { [scenario.module]: scenario.before } },
      { updatedAt: Date.now() - 600_000 }
    )
    apiClient.get = async () => ({
      data: {
        success: true,
        data: { HeaderNavModules: { [scenario.module]: scenario.after } },
      },
    })
    expect(
      await getModuleAccessForGuard(
        queryClient,
        scenario.module as HeaderNavModule
      )
    ).toEqual(scenario.after)
  })

  test('reuses fresh access but refreshes explicitly invalidated access', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(STATUS_QUERY_KEY, {
      HeaderNavModules: { pricing: false },
    })
    stubStatusEndpoint('updated')
    expect(await getModuleAccessForGuard(queryClient, 'pricing')).toEqual({
      enabled: false,
      requireAuth: false,
    })
    expect(statusRequests).toHaveLength(0)
    await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY })
    expect(await getModuleAccessForGuard(queryClient, 'pricing')).toEqual({
      enabled: true,
      requireAuth: false,
    })
    expect(statusRequests).toHaveLength(1)
  })

  test.each(['cold', 'stale'] as const)(
    'fails closed when a %s cache request fails',
    async (cacheState) => {
      const queryClient = createQueryClient()
      if (cacheState === 'stale') {
        queryClient.setQueryData(
          STATUS_QUERY_KEY,
          { HeaderNavModules: { pricing: true } },
          { updatedAt: Date.now() - 600_000 }
        )
      }
      apiClient.get = async () => {
        throw new Error('Status unavailable')
      }
      expect(await getModuleAccessForGuard(queryClient, 'pricing')).toEqual({
        enabled: false,
        requireAuth: true,
      })
    }
  )
})

describe('first-response favicon branding', () => {
  test.each(['/current.svg', '', '/logo.png'])(
    'server favicon %s overrides both old caches before mount without claiming an image loaded',
    (href) => {
      localStorage.setItem(
        'status',
        JSON.stringify({ logo: '/old-status.svg' })
      )
      localStorage.setItem(
        'system-config-storage',
        JSON.stringify({
          state: {
            config: {
              ...useSystemConfigStore.getState().config,
              logo: '/old-store.svg',
            },
            loadedLogoUrl: '/old-store.svg',
          },
          version: 0,
        })
      )
      useSystemConfigStore.persist.rehydrate()
      document.head.insertAdjacentHTML(
        'beforeend',
        `<link rel="icon" href="${href}" data-server-favicon>`
      )
      initializeSystemLogo('/old-status.svg')
      const expected = href || '/logo.png'
      expect(
        document
          .querySelector<HTMLLinkElement>('link[rel~="icon"]')
          ?.getAttribute('href')
      ).toBe(expected)
      expect(useSystemConfigStore.getState().config.logo).toBe(expected)
      expect(useSystemConfigStore.getState().loadedLogoUrl).toBe('')
      expect(
        JSON.parse(localStorage.getItem('system-config-storage') ?? '{}')
      ).toMatchObject({ state: { config: { logo: expected } } })
    }
  )

  test('blocked persistence does not leave the old logo in the mounted store', () => {
    useSystemConfigStore.getState().setConfig({ logo: '/old-store.svg' })
    document.head.insertAdjacentHTML(
      'beforeend',
      '<link rel="icon" href="/server.svg" data-server-favicon>'
    )
    const storage = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      })
    try {
      expect(() => initializeSystemLogo('/old-cache.svg')).not.toThrow()
      expect(useSystemConfigStore.getState().config.logo).toBe('/server.svg')
      expect(useSystemConfigStore.getState().loadedLogoUrl).toBe('')
    } finally {
      storage.mockRestore()
    }
  })

  test('standalone frontend keeps cached branding when there is no server marker', () => {
    document.head.insertAdjacentHTML(
      'beforeend',
      '<link rel="icon" href="/favicon.ico">'
    )
    initializeSystemLogo('/cached.svg')
    expect(
      document
        .querySelector<HTMLLinkElement>('link[rel~="icon"]')
        ?.getAttribute('href')
    ).toBe('/cached.svg')
    expect(useSystemConfigStore.getState().config.logo).toBe('/cached.svg')
  })

  test('fresh status replaces server branding and a cleaned-up image cannot restore it', async () => {
    const images: HTMLImageElement[] = []
    vi.stubGlobal(
      'Image',
      class {
        constructor() {
          const image = document.createElement('img')
          images.push(image)
          return image
        }
      }
    )
    document.head.insertAdjacentHTML(
      'beforeend',
      '<link rel="icon" href="/server.svg" data-server-favicon>'
    )
    initializeSystemLogo('/old.svg')
    const client = createQueryClient()
    renderHook(() => useSystemConfig(), { wrapper: wrapper(client) })
    expect(images[0].getAttribute('src')).toBe('/server.svg')
    apiClient.get = async () => ({
      data: { success: true, data: { logo: '/fresh.svg' } },
    })
    await act(async () => {
      await ensureStatus(client)
    })
    act(() => {
      images[1].dispatchEvent(new Event('load'))
    })
    expect(
      document
        .querySelector<HTMLLinkElement>('link[rel~="icon"]')
        ?.getAttribute('href')
    ).toBe('/fresh.svg')
    act(() => {
      images[0].dispatchEvent(new Event('load'))
    })
    expect(
      document
        .querySelector<HTMLLinkElement>('link[rel~="icon"]')
        ?.getAttribute('href')
    ).toBe('/fresh.svg')
    expect(useSystemConfigStore.getState().loadedLogoUrl).toBe('/fresh.svg')
  })
})
