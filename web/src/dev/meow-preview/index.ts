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
 * Local MeowAPI preview mode — development builds only.
 *
 * Signs in a sample user in memory and answers the signed-in API calls
 * with sample data, so console pages can be reviewed without logging in
 * (the live Turnstile check only accepts the production hostname). Public
 * endpoints still go to the real backend. Nothing is written anywhere:
 * every write returns a "not saved" message.
 *
 * Turn on with `?meow-preview=1`, off with `?meow-preview=0`.
 */
import axios, {
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'

import { applyAuthBundle } from '@/lib/auth-session'
import { api } from '@/lib/http-client'

import {
  PREVIEW_MODELS,
  previewCheckin,
  previewKeys,
  previewLogs,
  previewPerfModels,
  previewRankings,
  previewQuotaData,
  previewTopupInfo,
  previewUser,
} from './sample-data'

const STORAGE_KEY = 'meow-preview'

// Public endpoints keep using the live backend (without the fake token).
const PASS_THROUGH = [
  '/api/status',
  '/api/pricing',
  '/api/perf-metrics',
  '/api/notice',
  '/api/home_page_content',
  '/api/setup',
  '/api/about',
  '/api/user-agreement',
  '/api/privacy-policy',
  '/api/uptime/status',
]

/** Read the `?meow-preview=` switch and report whether preview is on. */
export function isMeowPreviewEnabled(): boolean {
  try {
    const flag = new URLSearchParams(window.location.search).get(STORAGE_KEY)
    if (flag === '1') localStorage.setItem(STORAGE_KEY, '1')
    if (flag === '0') localStorage.removeItem(STORAGE_KEY)
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

let checkedInToday = false

function ok(data: unknown, message = '') {
  return { success: true, message, data }
}

function mockResponse(
  method: string,
  path: string,
  params: URLSearchParams
): unknown {
  const page = Number(params.get('p') || 1)
  const size = Number(params.get('size') || params.get('page_size') || 10)

  if (method !== 'get') {
    if (path === '/api/user/checkin') {
      checkedInToday = true
      return ok({ quota_awarded: 100_000 })
    }
    if (/^\/api\/token\/\d+\/key$/.test(path)) {
      return ok({ key: 'sk-meowpreview0000000000000000' })
    }
    return { success: false, message: '本地预览模式：操作不会保存' }
  }

  if (path === '/api/user/self') return ok(previewUser())
  if (path === '/api/user/models') return ok(PREVIEW_MODELS)
  if (path === '/api/user/self/groups') {
    return ok({ default: { desc: '默认分组', ratio: 1 } })
  }
  if (path === '/api/token/' || path === '/api/token/search') {
    const keyword = (params.get('keyword') ?? '').toLowerCase()
    const keys = previewKeys().filter((key) =>
      key.name.toLowerCase().includes(keyword)
    )
    return ok({ items: keys, total: keys.length, page, page_size: size })
  }
  if (path === '/api/token/auto-groups') return ok([])
  const tokenMatch = /^\/api\/token\/(\d+)$/.exec(path)
  if (tokenMatch) {
    return ok(previewKeys().find((key) => key.id === Number(tokenMatch[1])))
  }
  if (path.startsWith('/api/data/flow')) return ok([])
  if (path === '/api/data/self') return ok(previewQuotaData())
  if (path === '/api/log/self/stat') {
    return ok({ quota: 24.16 * 500_000, rpm: 6, tpm: 14200 })
  }
  if (path === '/api/log/self') return ok(previewLogs(page, size))
  if (path.startsWith('/api/user/checkin')) {
    return ok(previewCheckin(checkedInToday))
  }
  if (path === '/api/user/topup/info') return ok(previewTopupInfo())
  if (path === '/api/rankings') return ok(previewRankings())
  if (path === '/api/user/aff') return ok('MEOW8312')
  if (path.startsWith('/api/subscription')) return ok([])
  if (path === '/api/user/sessions') return ok([])
  if (path === '/api/user/oauth/bindings') return ok([])
  if (path === '/api/user/2fa/status') return ok({ enabled: false })
  return ok(null)
}

/**
 * Edit a live JSON response. Adapters see the raw body (usually a string,
 * parsed later by axios), so parse, edit and serialise it back.
 */
function patchJson(
  response: AxiosResponse,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dev-only edits of loosely shaped JSON
  edit: (body: any) => void
) {
  try {
    const raw = response.data
    const body = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!body || typeof body !== 'object') return
    edit(body)
    response.data = typeof raw === 'string' ? JSON.stringify(body) : body
  } catch {
    /* leave the response as it is */
  }
}

function installAdapter() {
  const realAdapter = axios.getAdapter(api.defaults.adapter)
  api.defaults.adapter = async (
    config: InternalAxiosRequestConfig
  ): Promise<AxiosResponse> => {
    const url = new URL(config.url ?? '', window.location.origin)
    const path = url.pathname
    if (
      !path.startsWith('/api/') ||
      PASS_THROUGH.some((p) => path.startsWith(p))
    ) {
      config.headers.delete('Authorization')
      const response = await realAdapter(config)
      // Show the check-in card even when the live site has check-in off.
      if (path === '/api/status') {
        patchJson(response, (body) => {
          if (body.data) body.data.checkin_enabled = true
        })
      }
      // Give the sample models a health row next to the live ones.
      if (path === '/api/perf-metrics/summary') {
        patchJson(response, (body) => {
          if (Array.isArray(body.data?.models)) {
            body.data.models.push(...previewPerfModels())
          }
        })
      }
      return response
    }
    const query = new URLSearchParams(url.search)
    for (const [key, value] of Object.entries(config.params ?? {})) {
      if (value !== undefined && value !== null) query.set(key, String(value))
    }
    return {
      data: mockResponse((config.method ?? 'get').toLowerCase(), path, query),
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
      request: {},
    }
  }
}

function signInSampleUser() {
  const t = Math.floor(Date.now() / 1000)
  applyAuthBundle(
    {
      access_token: 'meow-preview-token',
      token_type: 'Bearer',
      access_expires_at: t + 30 * 86400,
      user: previewUser(),
      session: {
        sid: 'meow-preview',
        current: true,
        login_method: 'password',
        ip: '127.0.0.1',
        user_agent: navigator.userAgent,
        created_at: t,
        last_active_at: t,
        expires_at: t + 30 * 86400,
      },
    },
    false
  )
}

function showBadge() {
  const badge = document.createElement('a')
  badge.href = '?meow-preview=0'
  badge.textContent = '本地预览模式 · 示例数据 · 点击退出'
  badge.setAttribute(
    'style',
    'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:99999;' +
      'padding:7px 14px;border-radius:999px;background:#1e1b17;color:#f2cfa6;' +
      'font:600 12px/1.4 system-ui,sans-serif;text-decoration:none;' +
      'box-shadow:0 8px 24px -8px rgba(0,0,0,.5)'
  )
  document.body.appendChild(badge)
}

export function installMeowPreview() {
  installAdapter()
  signInSampleUser()
  showBadge()
}
