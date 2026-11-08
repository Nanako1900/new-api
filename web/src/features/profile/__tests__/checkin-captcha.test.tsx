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
import type { InternalAxiosRequestConfig } from 'axios'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { CheckinCalendarCard } from '../components/checkin-calendar-card'

const originalAdapter = api.defaults.adapter
let checkinRequests: InternalAxiosRequestConfig[] = []
let checkedInToday = false
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

beforeEach(() => {
  checkinRequests = []
  checkedInToday = false
  geetestStarts = 0
  challengesShown = 0
  installFakeGeetest()
  api.defaults.adapter = async (config) => {
    let data: unknown = {
      success: true,
      data: { stats: { checked_in_today: checkedInToday, records: [] } },
    }
    if (config.url === '/api/user/checkin' && config.method === 'post') {
      checkinRequests.push(config)
      data =
        checkinRequests.length === 1
          ? {
              success: false,
              message: 'Please complete the human verification first',
              code: 'CAPTCHA_REQUIRED',
            }
          : {
              success: true,
              message: '',
              data: { quota_awarded: 100, checkin_date: '2026-11-07' },
            }
    }
    return { data, status: 200, statusText: 'OK', headers: {}, config }
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  api.defaults.adapter = originalAdapter
  delete window.initGeetest4
})

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, {
    geetest_check: true,
    geetest_captcha_id: 'captcha-id',
    geetest_check_mode: 'risk',
  })
  render(
    <QueryClientProvider client={client}>
      <CheckinCalendarCard checkinEnabled />
    </QueryClientProvider>
  )
}

describe('profile check-in calendar with GeeTest', () => {
  it('in risk mode, checks in without a result and resends with one only when the server asks', async () => {
    const success = vi.spyOn(toast, 'success')
    const user = userEvent.setup()
    renderCard()

    await user.click(
      await screen.findByRole('button', { name: 'Check in now' })
    )

    await waitFor(() => expect(success).toHaveBeenCalledTimes(1))
    expect(challengesShown).toBe(1)
    expect(
      checkinRequests.map((config) => config.headers.has('X-Captcha-Token'))
    ).toEqual([false, true])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('when already checked in today, does not start GeeTest', async () => {
    checkedInToday = true
    renderCard()

    expect(
      await screen.findByRole('button', { name: 'Checked in' })
    ).toBeDisabled()
    expect(geetestStarts).toBe(0)
  })
})
