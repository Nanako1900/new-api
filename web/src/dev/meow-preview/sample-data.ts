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
 * Sample data for the local MeowAPI preview mode (development only).
 * Quota values use the backend unit of 500,000 per US dollar.
 */

const QUOTA_PER_USD = 500_000
const now = () => Math.floor(Date.now() / 1000)

export const PREVIEW_MODELS = [
  'claude-sonnet',
  'claude-opus',
  'claude-haiku',
  'gpt-6-sol',
  'gpt-6.1-terra',
  'gpt-5.6-luna',
]

export function previewUser() {
  return {
    id: 1001,
    username: 'meowfan',
    display_name: 'meowfan',
    email: 'meowfan@example.com',
    role: 1,
    status: 1,
    group: 'default',
    quota: Math.round(128.5 * QUOTA_PER_USD),
    used_quota: Math.round(191.5 * QUOTA_PER_USD),
    request_count: 8312,
    aff_code: 'MEOW8312',
    aff_count: 3,
    aff_quota: Math.round(6 * QUOTA_PER_USD),
    aff_history_quota: Math.round(12 * QUOTA_PER_USD),
    has_password: true,
    language: 'zh',
    setting: '{}',
    permissions: { sidebar_settings: true },
  }
}

export function previewKeys() {
  const t = now()
  const base = {
    unlimited_quota: false,
    expired_time: -1,
    group: 'default',
    auto_groups: null,
    cross_group_retry: false,
    model_limits_enabled: false,
    model_limits: '',
    allow_ips: '',
    allow_user_quota_query: false,
  }
  return [
    {
      ...base,
      id: 11,
      name: 'Claude Code',
      key: 'cc1fa3b9e0d24f7a9a1c',
      status: 1,
      remain_quota: 0,
      used_quota: Math.round(42.1 * QUOTA_PER_USD),
      unlimited_quota: true,
      created_time: t - 86400 * 30,
      accessed_time: t - 60,
    },
    {
      ...base,
      id: 12,
      name: '公司后端',
      key: 'b21c7e0f9a8d4c3b2e1f',
      status: 1,
      remain_quota: Math.round(120 * QUOTA_PER_USD),
      used_quota: Math.round(180 * QUOTA_PER_USD),
      created_time: t - 86400 * 21,
      accessed_time: t - 120,
      expired_time: t + 86400 * 60,
    },
    {
      ...base,
      id: 13,
      name: 'Codex',
      key: '77d0aa12bc34de56f789',
      status: 1,
      remain_quota: Math.round(41.58 * QUOTA_PER_USD),
      used_quota: Math.round(8.42 * QUOTA_PER_USD),
      created_time: t - 86400 * 9,
      accessed_time: t - 900,
      model_limits_enabled: true,
      model_limits: 'gpt-6-sol,gpt-5.6-luna',
    },
    {
      ...base,
      id: 14,
      name: '旧测试',
      key: '0e41ffee12aa34bb56cc',
      status: 2,
      remain_quota: Math.round(8 * QUOTA_PER_USD),
      used_quota: Math.round(2 * QUOTA_PER_USD),
      created_time: t - 86400 * 90,
      accessed_time: t - 86400 * 40,
    },
  ]
}

const LOG_SAMPLES = [
  {
    model: 'claude-sonnet',
    key: 'Claude Code',
    prompt: 2900,
    completion: 312,
    usd: 0.0128,
  },
  {
    model: 'gpt-6-sol',
    key: '公司后端',
    prompt: 1200,
    completion: 604,
    usd: 0.0061,
  },
  {
    model: 'claude-opus',
    key: 'Claude Code',
    prompt: 11800,
    completion: 590,
    usd: 0.0842,
  },
  {
    model: 'gpt-5.6-luna',
    key: 'Codex',
    prompt: 820,
    completion: 210,
    usd: 0.0019,
  },
  {
    model: 'claude-haiku',
    key: '公司后端',
    prompt: 520,
    completion: 120,
    usd: 0.0006,
  },
  {
    model: 'gpt-6.1-terra',
    key: 'Codex',
    prompt: 3300,
    completion: 940,
    usd: 0.0114,
  },
]

export function previewLogs(page: number, pageSize: number) {
  const t = now()
  const total = 48
  const start = (page - 1) * pageSize
  const items = Array.from(
    { length: Math.max(0, Math.min(pageSize, total - start)) },
    (_, i) => {
      const n = start + i
      const sample = LOG_SAMPLES[n % LOG_SAMPLES.length]
      return {
        id: 90000 - n,
        user_id: 1001,
        created_at: t - 75 - n * 410,
        type: 2,
        content: '',
        username: 'meowfan',
        token_name: sample.key,
        token_id: 11,
        model_name: sample.model,
        quota: Math.round(sample.usd * QUOTA_PER_USD),
        prompt_tokens: sample.prompt,
        completion_tokens: sample.completion,
        use_time: 1 + (n % 7),
        is_stream: n % 3 !== 0,
        channel: 0,
        group: 'default',
        ip: '',
        other: '{}',
      }
    }
  )
  return { items, total, page, page_size: pageSize }
}

/** Hourly usage buckets for the last seven days. */
export function previewQuotaData() {
  const hour = 3600
  const end = Math.floor(now() / hour) * hour
  const rows: Record<string, unknown>[] = []
  for (let h = 0; h < 24 * 7; h++) {
    const created_at = end - h * hour
    const wave = 1 + Math.sin(h / 3)
    for (const [index, model] of PREVIEW_MODELS.entries()) {
      const count = Math.round((index < 3 ? 6 : 3) * wave)
      if (count === 0) continue
      rows.push({
        id: rows.length + 1,
        user_id: 1001,
        username: 'meowfan',
        model_name: model,
        created_at,
        count,
        quota: Math.round(count * (index === 1 ? 0.06 : 0.008) * QUOTA_PER_USD),
        token_used: count * 2400,
      })
    }
  }
  return rows
}

export function previewCheckin(checkedInToday: boolean) {
  const today = new Date()
  const pad = (v: number) => String(v).padStart(2, '0')
  const records = [3, 2, 1, ...(checkedInToday ? [0] : [])].map((daysAgo) => {
    const d = new Date(today)
    d.setDate(today.getDate() - daysAgo)
    return {
      checkin_date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      quota_awarded: Math.round(0.2 * QUOTA_PER_USD),
    }
  })
  return {
    enabled: true,
    stats: {
      checked_in_today: checkedInToday,
      total_checkins: 18 + records.length,
      total_quota: Math.round((18 + records.length) * 0.2 * QUOTA_PER_USD),
      checkin_count: records.length,
      records,
    },
  }
}

export function previewTopupInfo() {
  return {
    enable_online_topup: true,
    enable_stripe_topup: false,
    pay_methods: [
      { name: '支付宝', type: 'alipay', color: '#1677FF' },
      { name: '微信支付', type: 'wxpay', color: '#07C160' },
    ],
    min_topup: 1,
    stripe_min_topup: 1,
    amount_options: [20, 50, 100, 200],
    discount: {},
    enable_redemption: true,
    payment_compliance_confirmed: true,
  }
}

/** Site-wide model health rows for the sample models. */
export function previewPerfModels() {
  return PREVIEW_MODELS.map((model_name, index) => ({
    model_name,
    success_rate: [99.6, 98.9, 99.9, 97.4, 99.2, 92.8][index] ?? 99,
    avg_latency_ms: [2400, 5200, 900, 3100, 2700, 1300][index] ?? 2000,
    avg_tps: 60,
    request_count: 1200 - index * 150,
  }))
}

const RANKING_MODELS = [
  {
    model_name: 'claude-sonnet',
    vendor: 'Anthropic',
    icon: 'Claude.Color',
    tokens: 42e9,
    growth: 18,
  },
  {
    model_name: 'gpt-6-sol',
    vendor: 'OpenAI',
    icon: 'OpenAI',
    tokens: 35e9,
    growth: 9,
  },
  {
    model_name: 'claude-opus',
    vendor: 'Anthropic',
    icon: 'Claude.Color',
    tokens: 21e9,
    growth: 34,
  },
  {
    model_name: 'gpt-6.1-terra',
    vendor: 'OpenAI',
    icon: 'OpenAI',
    tokens: 16e9,
    growth: -6,
  },
  {
    model_name: 'gemini-pro',
    vendor: 'Google',
    icon: 'Gemini.Color',
    tokens: 12e9,
    growth: 4,
  },
  {
    model_name: 'gpt-5.6-luna',
    vendor: 'OpenAI',
    icon: 'OpenAI',
    tokens: 9e9,
    growth: -12,
  },
  {
    model_name: 'claude-haiku',
    vendor: 'Anthropic',
    icon: 'Claude.Color',
    tokens: 7e9,
    growth: 22,
  },
  {
    model_name: 'deepseek-chat',
    vendor: 'DeepSeek',
    icon: 'DeepSeek.Color',
    tokens: 5e9,
    growth: 41,
  },
]

/** Last period's ranks: opus climbed past terra. */
const PREVIOUS_RANK: Record<number, number> = { 2: 4, 3: 3 }

/** Sample /api/rankings snapshot built from the preview models. */
export function previewRankings() {
  const total = RANKING_MODELS.reduce((sum, row) => sum + row.tokens, 0)
  const models = RANKING_MODELS.map((row, index) => ({
    rank: index + 1,
    previous_rank: PREVIOUS_RANK[index] ?? index + 1,
    model_name: row.model_name,
    vendor: row.vendor,
    vendor_icon: row.icon,
    category: 'all',
    total_tokens: row.tokens,
    share: row.tokens / total,
    growth_pct: row.growth,
  }))
  const byVendor = new Map<
    string,
    { tokens: number; count: number; top: string; icon: string }
  >()
  for (const row of RANKING_MODELS) {
    const entry = byVendor.get(row.vendor) ?? {
      tokens: 0,
      count: 0,
      top: row.model_name,
      icon: row.icon,
    }
    entry.tokens += row.tokens
    entry.count += 1
    byVendor.set(row.vendor, entry)
  }
  const vendors = [...byVendor.entries()]
    .sort((a, b) => b[1].tokens - a[1].tokens)
    .map(([vendor, entry], index) => ({
      rank: index + 1,
      vendor,
      vendor_icon: entry.icon,
      total_tokens: entry.tokens,
      share: entry.tokens / total,
      growth_pct: 10 - index * 4,
      models_count: entry.count,
      top_model: entry.top,
    }))
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() - 6 + index)
    return {
      ts: date.toISOString(),
      label: `${date.getMonth() + 1}/${date.getDate()}`,
    }
  })
  const historyPoints = days.flatMap((day, index) =>
    RANKING_MODELS.map((row) => ({
      ts: day.ts,
      label: day.label,
      model: row.model_name,
      vendor: row.vendor,
      tokens: Math.round(
        (row.tokens / 7) * (0.8 + ((index * 7 + row.tokens / 1e9) % 5) / 10)
      ),
    }))
  )
  const vendorPoints = days.flatMap((day) =>
    vendors.map((vendor) => ({
      ts: day.ts,
      label: day.label,
      vendor: vendor.vendor,
      share: vendor.share,
      tokens: vendor.total_tokens / 7,
    }))
  )
  const mover = (row: (typeof models)[number], delta: number) => ({
    model_name: row.model_name,
    vendor: row.vendor,
    vendor_icon: row.vendor_icon,
    rank_delta: delta,
    current_rank: row.rank,
    growth_pct: row.growth_pct,
  })
  return {
    models,
    vendors,
    top_movers: [mover(models[2], 2), mover(models[7], 1)],
    top_droppers: [mover(models[3], -1), mover(models[5], -1)],
    models_history: {
      points: historyPoints,
      models: RANKING_MODELS.map((row) => ({
        name: row.model_name,
        vendor: row.vendor,
        total: row.tokens,
      })),
      buckets: days.length,
    },
    vendor_share_history: {
      points: vendorPoints,
      vendors: vendors.map((vendor) => ({
        name: vendor.vendor,
        total: vendor.total_tokens,
        share: vendor.share,
      })),
      buckets: days.length,
    },
  }
}
