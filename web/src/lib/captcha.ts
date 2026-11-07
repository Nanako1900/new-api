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
/**
 * Request header that carries a GeeTest v4 result to the server. A header
 * keeps the single-use pass token out of URLs and access logs.
 */
export const CAPTCHA_TOKEN_HEADER = 'X-Captcha-Token'

/** Headers for a request guarded by the server's captcha check. */
export function captchaHeaders(token?: string): Record<string, string> {
  return token ? { [CAPTCHA_TOKEN_HEADER]: token } : {}
}

/**
 * Whether the server rejected a request at the captcha check
 * (`CAPTCHA_REQUIRED`, `CAPTCHA_FAILED` or `CAPTCHA_UNAVAILABLE`).
 */
export function isCaptchaRejection(response: { code?: unknown }): boolean {
  return (
    typeof response.code === 'string' && response.code.startsWith('CAPTCHA_')
  )
}
