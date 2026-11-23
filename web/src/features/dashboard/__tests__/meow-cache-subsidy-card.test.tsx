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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheSubsidyQueryKeys } from '@/features/cache-subsidy/lib/query-keys'
import type { UserCacheSubsidy } from '@/features/cache-subsidy/types'
import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'
import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { type AuthUser, useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { MeowCacheSubsidyCard } from '../components/meow-overview/meow-cache-subsidy-card'

type ClaimReply = {
  success: boolean
  message: string
  code?: string
  data?: { quota: number }
}

const CAPTCHA_REQUIRED: ClaimReply = {
  success: false,
  message: 'Please complete the human verification first',
  code: 'CAPTCHA_REQUIRED',
}
const CLAIMED: ClaimReply = {
  success: true,
  message: '',
  data: { quota: 750_000 },
}
const ALREADY_CLAIMED: ClaimReply = {
  success: false,
  message: 'Cache subsidy already claimed',
}

// 2100-01-01: the claim period is still running whenever the test runs.
const FAR_DEADLINE = 4_102_444_800
const CLAIMED_AT = Math.floor(new Date(2026, 10, 24, 10, 30).getTime() / 1000)

function subsidy(status: 'pending' | 'claimed'): UserCacheSubsidy {
  return {
    campaign: {
      id: 9,
      name: 'November cache refund',
      description: 'Cache prices dropped; here is 75% back.',
      subsidy_percent: 75,
      include_cache_writes: true,
      window_start: Math.floor(new Date(2026, 10, 13).getTime() / 1000),
      window_end: Math.floor(new Date(2026, 10, 20, 12).getTime() / 1000),
      claim_deadline: FAR_DEADLINE,
    },
    grant: {
      log_count: 120,
      cache_read_tokens: 1_500_000,
      cache_write_tokens: 200_000,
      cache_quota: 1_000_000,
      subsidy_quota: 750_000,
      status,
      claimed_at: status === 'claimed' ? CLAIMED_AT : 0,
    },
  }
}

const originalAdapter = api.defaults.adapter
let subsidies: UserCacheSubsidy[] = []
let claimRequests: InternalAxiosRequestConfig[] = []
let claimReplies: ClaimReply[] = []
let selfRequests = 0
let geetestStarts = 0
let challengesShown = 0

/** Stands in for gt4.js in bind mode: the user passes each challenge at once. */
function installFakeGeetest() {
  window.initGeetest4 = ((
    _config: unknown,
    callback: (captcha: unknown) => void
  ) => {
    geetestStarts += 1
    let onReady = () => {}
    let onSuccess = () => {}
    const instance = {
      getValidate: () => ({
        lot_number: 'lot',
        captcha_output: 'output',
        pass_token: 'pass',
        gen_time: '1700000000',
      }),
      showCaptcha: () => {
        challengesShown += 1
        setTimeout(onSuccess)
      },
      onReady: (next: () => void) => {
        onReady = next
        return instance
      },
      onSuccess: (next: () => void) => {
        onSuccess = next
        return instance
      },
      onClose: () => instance,
      onError: () => instance,
      destroy: () => {},
    }
    callback(instance)
    onReady()
  }) as unknown as Window['initGeetest4']
}

function renderCard(
  geetest: 'off' | 'risk' = 'off',
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
) {
  client.setQueryData(STATUS_QUERY_KEY, {
    cache_subsidy_enabled: true,
    geetest_check: geetest !== 'off',
    geetest_captcha_id: geetest !== 'off' ? 'captcha-id' : '',
    geetest_check_mode: 'risk',
  })
  render(
    <QueryClientProvider client={client}>
      <MeowCacheSubsidyCard />
    </QueryClientProvider>
  )
  return client
}

function sentTokens(): Array<string | null> {
  return claimRequests.map((config) => {
    const token = config.headers.get('X-Captcha-Token')
    return typeof token === 'string' ? token : null
  })
}

beforeEach(() => {
  subsidies = [subsidy('pending')]
  claimRequests = []
  claimReplies = []
  selfRequests = 0
  geetestStarts = 0
  challengesShown = 0
  installFakeGeetest()
  useSystemConfigStore.getState().setConfig({
    currency: {
      displayInCurrency: true,
      quotaDisplayType: 'USD',
      quotaPerUnit: 500000,
      usdExchangeRate: 1,
      customCurrencySymbol: '¤',
      customCurrencyExchangeRate: 1,
    },
  })
  useAuthStore.getState().auth.setUser({
    id: 7,
    username: 'meow',
    role: 1,
    quota: 1_000_000,
  } as AuthUser)
  api.defaults.adapter = async (config) => {
    let data: unknown = { success: false, message: '' }
    if (config.url === '/api/user/cache_subsidy' && config.method === 'get') {
      data = { success: true, data: subsidies }
    }
    if (
      config.url === '/api/user/cache_subsidy/claim' &&
      config.method === 'post'
    ) {
      claimRequests.push(config)
      const reply = claimReplies.shift()
      // The server records the claim; the next list read shows it.
      if (reply?.success || reply === ALREADY_CLAIMED) {
        subsidies = [subsidy('claimed')]
      }
      data = reply
    }
    if (config.url === '/api/user/self') {
      selfRequests += 1
      data = {
        success: true,
        data: { id: 7, username: 'meow', role: 1, quota: 1_750_000 },
      }
    }
    return { data, status: 200, statusText: 'OK', headers: {}, config }
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  api.defaults.adapter = originalAdapter
  delete window.initGeetest4
  useAuthStore.getState().auth.setUser(null)
  localStorage.clear()
})

describe('Meow cache subsidy card', () => {
  it('shows the subsidy, the cache usage it refunds and the claim period', async () => {
    renderCard()

    const panel = await screen.findByRole('article', {
      name: 'November cache refund',
    })
    expect(panel).toHaveTextContent('$1.5')
    expect(panel).toHaveTextContent('75% back')
    expect(panel).toHaveTextContent('Cache reads1.5M tokens')
    expect(panel).toHaveTextContent('Cache writes200K tokens')
    expect(panel).toHaveTextContent('Cache cost$2')
    expect(panel).toHaveTextContent('2026-11-13 00:00 – 2026-11-20 12:00')
    expect(panel).toHaveTextContent('Claim by2100-01-01')
  })

  it('claims the subsidy, then shows it as claimed and refreshes the balance', async () => {
    const success = vi.spyOn(toast, 'success')
    claimReplies = [CLAIMED]
    const user = userEvent.setup()
    renderCard()

    await user.click(await screen.findByRole('button', { name: /^Claim / }))

    await waitFor(() =>
      expect(success).toHaveBeenCalledWith('Cache subsidy received $1.5')
    )
    expect(claimRequests).toHaveLength(1)
    expect(JSON.parse(claimRequests[0].data as string)).toEqual({
      campaign_id: 9,
    })
    expect(sentTokens()).toEqual([null])
    await waitFor(() =>
      expect(useAuthStore.getState().auth.user?.quota).toBe(1_750_000)
    )
    expect(selfRequests).toBe(1)
    expect(
      await screen.findByRole('button', { name: 'Claimed · 2026-11-24 10:30' })
    ).toBeDisabled()
  })

  it('when the subsidy was already claimed elsewhere, shows the server reason and the claimed state', async () => {
    const error = vi.spyOn(toast, 'error')
    claimReplies = [ALREADY_CLAIMED]
    const user = userEvent.setup()
    renderCard()

    await user.click(await screen.findByRole('button', { name: /^Claim / }))

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith('Cache subsidy already claimed')
    )
    expect(
      await screen.findByRole('button', { name: /^Claimed · / })
    ).toBeDisabled()
    expect(selfRequests).toBe(0)
  })

  it('in risk mode, claims without a result and resends with one only when the server asks', async () => {
    const success = vi.spyOn(toast, 'success')
    claimReplies = [CAPTCHA_REQUIRED, CLAIMED]
    const user = userEvent.setup()
    renderCard('risk')

    await user.click(await screen.findByRole('button', { name: /^Claim / }))

    await waitFor(() => expect(claimRequests).toHaveLength(2))
    expect(sentTokens()[0]).toBeNull()
    expect(JSON.parse(sentTokens()[1] as string)).toEqual({
      lot_number: 'lot',
      captcha_output: 'output',
      pass_token: 'pass',
      gen_time: '1700000000',
    })
    expect(challengesShown).toBe(1)
    await waitFor(() => expect(success).toHaveBeenCalledTimes(1))
  })

  it('with only claimed subsidies, does not start GeeTest', async () => {
    subsidies = [subsidy('claimed')]
    renderCard('risk')

    expect(
      await screen.findByRole('button', { name: /^Claimed · / })
    ).toBeDisabled()
    expect(geetestStarts).toBe(0)
  })

  it('when the subsidy list fails with a server error, hides the card without a toast or the 500 page', async () => {
    const error = vi.spyOn(toast, 'error')
    const onInternalServerError = vi.fn()
    api.defaults.adapter = async (config) => {
      throw new AxiosError(
        'Request failed with status code 500',
        AxiosError.ERR_BAD_RESPONSE,
        config,
        null,
        {
          data: { success: false, message: 'database is down' },
          status: 500,
          statusText: 'Internal Server Error',
          headers: {},
          config,
        }
      )
    }
    const client = createAppQueryClient(onInternalServerError)
    client.setDefaultOptions({ queries: { retry: false } })
    renderCard('off', client)

    await waitFor(() =>
      expect(client.getQueryState(cacheSubsidyQueryKeys.user())?.status).toBe(
        'error'
      )
    )
    expect(onInternalServerError).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('heading', { name: 'Cache subsidy' })
    ).not.toBeInTheDocument()
    client.clear()
  })

  it('with no subsidies, renders nothing', async () => {
    subsidies = []
    const client = renderCard()

    await waitFor(() => expect(client.isFetching()).toBe(0))
    expect(
      screen.queryByRole('heading', { name: 'Cache subsidy' })
    ).not.toBeInTheDocument()
  })
})
