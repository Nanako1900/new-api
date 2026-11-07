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
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { PASSWORD_RESET_TOKEN_STORAGE_KEY } from '../lib/reset-link'

// The inline script in index.html that takes the reset token out of the URL
// before any analytics script (Umami, Google Analytics) can record it.
// Vitest runs from web/, where index.html lives.
const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
const scripts = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)]
const bootstrap = scripts.find((match) =>
  match[1].includes(PASSWORD_RESET_TOKEN_STORAGE_KEY)
)

function openAt(url: string) {
  window.history.replaceState(null, '', url)
  // Runs the page's own inline script as the browser would, in global scope.
  // oxlint-disable-next-line no-eval
  ;(0, eval)(bootstrap?.[1] ?? '')
}

afterEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('password reset token bootstrap in index.html', () => {
  it('runs before the analytics placeholders are filled in', () => {
    expect(bootstrap).toBeDefined()
    const position = indexHtml.indexOf(bootstrap?.[0] ?? '')
    expect(position).toBeLessThan(indexHtml.indexOf('<!--umami-->'))
    expect(position).toBeLessThan(indexHtml.indexOf('<!--Google Analytics-->'))
  })

  it.each(['/user/reset', '/reset'])(
    'on %s, moves the token from the address bar into session storage',
    (path) => {
      openAt(`${path}?token=abc-123&from=mail#top`)

      expect(sessionStorage.getItem(PASSWORD_RESET_TOKEN_STORAGE_KEY)).toBe(
        'abc-123'
      )
      expect(window.location.pathname).toBe(path)
      expect(window.location.search).toBe('?from=mail')
      expect(window.location.hash).toBe('#top')
    }
  )

  it('leaves other pages alone', () => {
    openAt('/sign-in?token=abc-123')

    expect(window.location.search).toBe('?token=abc-123')
    expect(sessionStorage.getItem(PASSWORD_RESET_TOKEN_STORAGE_KEY)).toBeNull()
  })

  it('keeps the token in the address bar when session storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })

    openAt('/user/reset?token=abc-123')

    // The page then reads it from the URL and removes it itself.
    expect(window.location.search).toBe('?token=abc-123')
  })
})
