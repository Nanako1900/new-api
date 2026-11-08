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

import { MeowCheckinCard } from '../components/meow-overview/meow-checkin-card'

type CheckinReply = {
  success: boolean
  message: string
  code?: string
  data?: { quota_awarded: number; checkin_date: string }
}

const CAPTCHA_REQUIRED: CheckinReply = {
  success: false,
  message: 'Please complete the human verification first',
  code: 'CAPTCHA_REQUIRED',
}
const CHECKED_IN: CheckinReply = {
  success: true,
  message: 'Check-in successful',
  data: { quota_awarded: 100, checkin_date: '2026-11-07' },
}

const originalAdapter = api.defaults.adapter
let checkinRequests: InternalAxiosRequestConfig[] = []
let checkinReplies: CheckinReply[] = []
let checkedInToday = false
let geetestStarts = 0
let challengesShown = 0
let challengeAnswers: Array<'pass' | 'close'> = []

/** Stands in for gt4.js in bind mode: the user answers each challenge at once. */
function installFakeGeetest() {
  window.initGeetest4 = ((
    _config: unknown,
    callback: (captcha: unknown) => void
  ) => {
    geetestStarts += 1
    let onReady = () => {}
    let onSuccess = () => {}
    let onClose = () => {}
    const instance = {
      getValidate: () => ({
        lot_number: 'lot',
        captcha_output: 'output',
        pass_token: 'pass',
        gen_time: '1700000000',
      }),
      showCaptcha: () => {
        challengesShown += 1
        const answer = challengeAnswers.shift() ?? 'pass'
        setTimeout(answer === 'pass' ? onSuccess : onClose)
      },
      onReady: (next: () => void) => {
        onReady = next
        return instance
      },
      onSuccess: (next: () => void) => {
        onSuccess = next
        return instance
      },
      onClose: (next: () => void) => {
        onClose = next
        return instance
      },
      onError: () => instance,
      destroy: () => {},
    }
    callback(instance)
    onReady()
  }) as unknown as Window['initGeetest4']
}

function renderCard(mode: 'always' | 'risk') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, {
    checkin_enabled: true,
    geetest_check: true,
    geetest_captcha_id: 'captcha-id',
    geetest_check_mode: mode,
  })
  render(
    <QueryClientProvider client={client}>
      <MeowCheckinCard />
    </QueryClientProvider>
  )
}

function sentTokens(): Array<string | null> {
  return checkinRequests.map((config) => {
    const token = config.headers.get('X-Captcha-Token')
    return typeof token === 'string' ? token : null
  })
}

beforeEach(() => {
  checkinRequests = []
  checkinReplies = []
  checkedInToday = false
  geetestStarts = 0
  challengesShown = 0
  challengeAnswers = []
  installFakeGeetest()
  api.defaults.adapter = async (config) => {
    let data: unknown = { success: false, message: '' }
    if (
      config.url?.startsWith('/api/user/checkin') &&
      config.method === 'get'
    ) {
      data = {
        success: true,
        data: { stats: { checked_in_today: checkedInToday, records: [] } },
      }
    }
    if (config.url === '/api/user/checkin' && config.method === 'post') {
      checkinRequests.push(config)
      data = checkinReplies.shift()
    }
    return { data, status: 200, statusText: 'OK', headers: {}, config }
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  api.defaults.adapter = originalAdapter
  delete window.initGeetest4
})

describe('Meow check-in with GeeTest', () => {
  it('in risk mode, checks in without a result and resends with one only when the server asks', async () => {
    const success = vi.spyOn(toast, 'success')
    checkinReplies = [CAPTCHA_REQUIRED, CHECKED_IN]
    const user = userEvent.setup()
    renderCard('risk')

    await user.click(
      await screen.findByRole('button', { name: 'Check in now' })
    )

    await waitFor(() => expect(checkinRequests).toHaveLength(2))
    expect(sentTokens()[0]).toBeNull()
    expect(JSON.parse(sentTokens()[1] as string)).toEqual({
      lot_number: 'lot',
      captcha_output: 'output',
      pass_token: 'pass',
      gen_time: '1700000000',
    })
    expect(challengesShown).toBe(1)
    await waitFor(() => expect(success).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('in risk mode, a failure that is not a captcha request shows no challenge', async () => {
    const error = vi.spyOn(toast, 'error')
    checkinReplies = [
      { success: false, message: 'Check-in feature is not enabled' },
    ]
    const user = userEvent.setup()
    renderCard('risk')

    await user.click(
      await screen.findByRole('button', { name: 'Check in now' })
    )

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith('Check-in feature is not enabled')
    )
    expect(checkinRequests).toHaveLength(1)
    expect(challengesShown).toBe(0)
  })

  it('in always mode, challenges before the first check-in request', async () => {
    checkinReplies = [CHECKED_IN]
    const user = userEvent.setup()
    renderCard('always')

    await user.click(
      await screen.findByRole('button', { name: 'Check in now' })
    )

    await waitFor(() => expect(checkinRequests).toHaveLength(1))
    expect(sentTokens()[0]).not.toBeNull()
    expect(challengesShown).toBe(1)
  })

  it('when the user closes the challenge, does not resend and re-enables the button', async () => {
    checkinReplies = [CAPTCHA_REQUIRED]
    challengeAnswers = ['close']
    const user = userEvent.setup()
    renderCard('risk')
    const button = await screen.findByRole('button', { name: 'Check in now' })

    await user.click(button)

    await waitFor(() => expect(challengesShown).toBe(1))
    await waitFor(() => expect(button).toBeEnabled())
    expect(checkinRequests).toHaveLength(1)
  })

  it('when already checked in today, does not start GeeTest', async () => {
    checkedInToday = true
    renderCard('risk')

    expect(
      await screen.findByRole('button', {
        name: 'Checked in today · see you tomorrow',
      })
    ).toBeDisabled()
    expect(geetestStarts).toBe(0)
  })
})
