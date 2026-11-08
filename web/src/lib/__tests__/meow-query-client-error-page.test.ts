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
import { toast } from 'sonner'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppQueryClient } from '@/lib/query-client'

const error = Object.assign(new Error('boom'), { response: { status: 500 } })

afterEach(() => {
  vi.restoreAllMocks()
})

it('opens the 500 page for a failing query by default', async () => {
  vi.spyOn(toast, 'error').mockReturnValue('error')
  const onInternalServerError = vi.fn()
  const client = createAppQueryClient(onInternalServerError)

  await expect(
    client.fetchQuery({ queryKey: ['x'], queryFn: () => Promise.reject(error) })
  ).rejects.toBe(error)

  expect(onInternalServerError).toHaveBeenCalledTimes(1)
})

it('skips the 500 page for a query that opts out with errorPage false', async () => {
  vi.spyOn(toast, 'error').mockReturnValue('error')
  const onInternalServerError = vi.fn()
  const client = createAppQueryClient(onInternalServerError)

  await expect(
    client.fetchQuery({
      queryKey: ['x'],
      queryFn: () => Promise.reject(error),
      meta: { errorPage: false },
    })
  ).rejects.toBe(error)

  expect(onInternalServerError).not.toHaveBeenCalled()
})
