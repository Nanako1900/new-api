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
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { type AuthUser, useAuthStore } from '@/stores/auth-store'

import {
  LIVE_BALANCE_INTERVAL_MS,
  mergeBalance,
  useLiveBalance,
  useLiveBalanceTotals,
} from '../use-live-balance'

const ALICE: AuthUser = {
  id: 1,
  username: 'alice',
  role: 1,
  quota: 500,
  used_quota: 0,
  request_count: 0,
  permissions: { sidebar_settings: true },
}

/** Answers `/api/user/self` with the given balances in turn, then the last. */
function serveBalances(quotas: number[]) {
  const queue = [...quotas]
  return vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url !== '/api/user/self') throw new Error(`Unexpected GET ${url}`)
    const quota = queue.length > 1 ? queue.shift() : queue[0]
    return { data: { success: true, data: { id: 1, quota } } }
  })
}

function wrapper(props: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
  )
}

/** Lets timers, request promises and React effects settle. */
async function elapse(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
    // A fetch fired by the last tick reaches React on the next timer turn.
    await vi.advanceTimersByTimeAsync(1)
  })
}

const storedQuota = () => useAuthStore.getState().auth.user?.quota

beforeEach(() => {
  vi.useFakeTimers()
  focusManager.setFocused(true)
  useAuthStore.getState().auth.setUser({ ...ALICE })
})

afterEach(() => {
  focusManager.setFocused(undefined)
  vi.useRealTimers()
  vi.restoreAllMocks()
  useAuthStore.getState().auth.reset()
})

test('a fresh copy updates the balance fields and keeps the rest', () => {
  const next = mergeBalance(ALICE, { id: 1, quota: 420, used_quota: 80 })

  expect(next).toEqual({ ...ALICE, quota: 420, used_quota: 80 })
})

test('a fresh copy with unchanged balance reports no change', () => {
  expect(mergeBalance(ALICE, { id: 1, quota: 500, used_quota: 0 })).toBeNull()
})

test('a fresh copy of another account is ignored', () => {
  expect(mergeBalance(ALICE, { id: 2, quota: 1 })).toBeNull()
})

test('the console reads the balance on mount and every 30 seconds', async () => {
  serveBalances([400, 300])
  renderHook(() => useLiveBalance(true), { wrapper })

  await elapse(0)
  expect(storedQuota()).toBe(400)

  await elapse(LIVE_BALANCE_INTERVAL_MS)
  expect(storedQuota()).toBe(300)
})

test('polling pauses while the tab is hidden', async () => {
  const get = serveBalances([400, 300])
  renderHook(() => useLiveBalance(true), { wrapper })
  await elapse(0)

  act(() => focusManager.setFocused(false))
  await elapse(LIVE_BALANCE_INTERVAL_MS * 3)

  expect(get).toHaveBeenCalledTimes(1)
  expect(storedQuota()).toBe(400)
})

test('returning to the tab reads the balance right away', async () => {
  serveBalances([400, 300])
  renderHook(() => useLiveBalance(true), { wrapper })
  await elapse(0)
  act(() => focusManager.setFocused(false))

  act(() => focusManager.setFocused(true))
  await elapse(0)

  expect(storedQuota()).toBe(300)
})

test('a signed-out console does not read the balance', async () => {
  const get = serveBalances([400])
  renderHook(() => useLiveBalance(false), { wrapper })

  await elapse(LIVE_BALANCE_INTERVAL_MS)

  expect(get).not.toHaveBeenCalled()
})

test('a page fetching a newer balance updates the shared one', async () => {
  const pageCopy = { id: 1, quota: 900, used_quota: 40, request_count: 7 }
  const { result } = renderHook(() => useLiveBalanceTotals(pageCopy))
  await elapse(0)

  expect(result.current).toEqual({
    quota: 900,
    usedQuota: 40,
    requestCount: 7,
  })
  expect(storedQuota()).toBe(900)
})
