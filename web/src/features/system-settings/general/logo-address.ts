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
import { z } from 'zod'

// Any origin works here: a site path is valid when it resolves back to it.
const SITE_ORIGIN_PROBE = 'http://site.invalid'

/**
 * The Logo setting takes an absolute URL or a path on this site, such as
 * `/meow-logo.svg` for an image shipped in `web/public`, which the server
 * serves from its own domain. Paths that resolve to another host
 * (`//host/...`, `/\host/...`) are rejected.
 */
export function isValidLogoAddress(value: string): boolean {
  if (value === '') return true
  if (value !== value.trim()) return false
  if (!value.startsWith('/')) return z.url().safeParse(value).success

  try {
    return new URL(value, SITE_ORIGIN_PROBE).origin === SITE_ORIGIN_PROBE
  } catch {
    return false
  }
}
