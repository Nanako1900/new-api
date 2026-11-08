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
 * The reply code with which the server asks for a GeeTest result it did not
 * get. `CAPTCHA_FAILED` and `CAPTCHA_UNAVAILABLE` reject a result it did get.
 */
export const CAPTCHA_REQUIRED_CODE = 'CAPTCHA_REQUIRED'
