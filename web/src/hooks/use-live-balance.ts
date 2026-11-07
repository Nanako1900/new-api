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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { getSelf } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'
import { type AuthUser, useAuthStore } from '@/stores/auth-store'

// MeowAPI: the signed-in user is loaded once per page load, so the console
// balance went stale while people called the API from their own tools.
// These helpers keep the balance fields of that user current.

/** How often the console re-reads the balance while its tab is visible. */
export const LIVE_BALANCE_INTERVAL_MS = 30 * 1000

/** The account fields that move as the user spends, tops up or invites. */
const BALANCE_FIELDS = [
  'quota',
  'used_quota',
  'request_count',
  'aff_count',
  'aff_quota',
  'aff_history_quota',
] as const

type BalanceField = (typeof BALANCE_FIELDS)[number]

/** A fresh copy of an account, from `/api/user/self` or a page's own fetch. */
export type FreshBalance = { id: number } & Partial<
  Pick<AuthUser, BalanceField>
>

/**
 * The signed-in user with the fresh balance fields copied in, or null when
 * nothing changed or the fresh copy belongs to a different account.
 */
export function mergeBalance(
  current: AuthUser,
  fresh: FreshBalance
): AuthUser | null {
  if (fresh.id !== current.id) return null

  const next: AuthUser = { ...current }
  let changed = false
  for (const field of BALANCE_FIELDS) {
    const value = fresh[field]
    if (value === undefined || value === current[field]) continue
    next[field] = value
    changed = true
  }
  return changed ? next : null
}

/** Copies fresh balance fields into the signed-in user. True if any moved. */
export function syncBalance(fresh: FreshBalance): boolean {
  const auth = useAuthStore.getState().auth
  if (!auth.user) return false
  const next = mergeBalance(auth.user, fresh)
  if (!next) return false
  auth.setUser(next)
  return true
}

/**
 * Keeps the signed-in user's balance current across the console: re-reads
 * the account every 30 seconds while the tab is visible and again as soon
 * as the user returns to the tab. New spend also refreshes the overview's
 * recent calls. Mount once, in the console layout.
 */
export function useLiveBalance(enabled: boolean): void {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['user', 'self', 'live-balance'],
    queryFn: async () =>
      requireServerSuccess(await getSelf()).data as FreshBalance,
    enabled,
    refetchInterval: LIVE_BALANCE_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: false,
    meta: { errorToast: false },
  })

  useEffect(() => {
    if (!query.data) return
    const spentBefore = useAuthStore.getState().auth.user?.used_quota
    if (!syncBalance(query.data)) return
    if (query.data.used_quota !== spentBefore) {
      void queryClient.invalidateQueries({
        queryKey: ['dashboard', 'overview', 'recent-calls'],
      })
    }
  }, [query.data, queryClient])
}

/**
 * Balance, total usage and request count for a console card. Shows the live
 * values of the signed-in user, after pushing the page's own copy (fetched
 * on mount or after a top-up) into them, so both sources agree.
 */
export function useLiveBalanceTotals(pageCopy: FreshBalance | null) {
  const user = useAuthStore((state) => state.auth.user)

  useEffect(() => {
    if (pageCopy) syncBalance(pageCopy)
  }, [pageCopy])

  return {
    quota: user?.quota ?? pageCopy?.quota ?? 0,
    usedQuota: user?.used_quota ?? pageCopy?.used_quota ?? 0,
    requestCount: user?.request_count ?? pageCopy?.request_count ?? 0,
  }
}
