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
import type { ChannelAffinitySettings } from '../general/channel-affinity/types'
import type { SecuritySettings } from '../types'

export type RetrySettings = {
  RetryTimes: number
  AutomaticRetryStatusCodes: string
}
export type HealthSettings = {
  ChannelDisableThreshold: string
  AutomaticDisableChannelEnabled: boolean
  AutomaticEnableChannelEnabled: boolean
  AutomaticDisableKeywords: string
  AutomaticDisableStatusCodes: string
  'monitor_setting.auto_test_channel_enabled': boolean
  'monitor_setting.auto_test_channel_minutes': number
  'monitor_setting.channel_test_concurrency': number
  'monitor_setting.channel_test_mode':
    | 'scheduled_all'
    | 'auto_ban_only'
    | 'passive_recovery'
}
export type FilteringSettings = Pick<
  SecuritySettings,
  'CheckSensitiveEnabled' | 'CheckSensitiveOnPromptEnabled' | 'SensitiveWords'
>
export type ContentReviewMode = 'off' | 'shadow' | 'enforce'
// Options of the content safety review tier, stored as
// `content_safety_setting.*`. The hard-block word tier keeps FilteringSettings.
export type ContentSafetySettings = {
  'content_safety_setting.review_mode': ContentReviewMode
  'content_safety_setting.review_model': string
  'content_safety_setting.review_group': string
  'content_safety_setting.review_prompt': string
  'content_safety_setting.review_tool_results': boolean
  'content_safety_setting.review_timeout_seconds': number
  'content_safety_setting.review_max_concurrency': number
  'content_safety_setting.review_rate_limit_per_minute': number
  'content_safety_setting.unit_chars': number
  'content_safety_setting.max_units': number
  'content_safety_setting.async_workers': number
  'content_safety_setting.async_queue_size': number
  'content_safety_setting.async_rate_per_minute': number
  'content_safety_setting.pass_log_percent': number
  'content_safety_setting.sync_all': boolean
  'content_safety_setting.sync_new_user_days': number
  'content_safety_setting.sync_groups': string
  'content_safety_setting.cache_ttl_seconds': number
  'content_safety_setting.log_retention_days': number
}
// Per-account risk score options of the same `content_safety_setting` struct.
// `risk_zero_tolerance_categories` holds one category per line.
export type ContentRiskSettings = {
  'content_safety_setting.risk_half_life_hours': number
  'content_safety_setting.risk_points_unsafe': number
  'content_safety_setting.risk_points_controversial': number
  'content_safety_setting.risk_zero_tolerance_categories': string
  'content_safety_setting.risk_watch_threshold': number
  'content_safety_setting.risk_restrict_threshold': number
  'content_safety_setting.risk_block_threshold': number
  'content_safety_setting.risk_restrict_rpm': number
  'content_safety_setting.risk_notify_enabled': boolean
}
export type RequestPolicySettings = RetrySettings &
  HealthSettings &
  FilteringSettings &
  ContentSafetySettings &
  ContentRiskSettings &
  Pick<ChannelAffinitySettings, keyof ChannelAffinitySettings>

export const defaultRequestPolicySettings: RequestPolicySettings = {
  RetryTimes: 0,
  AutomaticRetryStatusCodes:
    '100-199,300-399,401-407,409-499,500-503,505-523,525-599',
  ChannelDisableThreshold: '',
  AutomaticDisableChannelEnabled: false,
  AutomaticEnableChannelEnabled: false,
  AutomaticDisableKeywords: '',
  AutomaticDisableStatusCodes: '401',
  'monitor_setting.auto_test_channel_enabled': false,
  'monitor_setting.auto_test_channel_minutes': 10,
  'monitor_setting.channel_test_concurrency': 1,
  'monitor_setting.channel_test_mode': 'scheduled_all',
  'channel_affinity_setting.enabled': false,
  'channel_affinity_setting.session_mode': '',
  'channel_affinity_setting.switch_on_success': true,
  'channel_affinity_setting.keep_on_channel_disabled': false,
  'channel_affinity_setting.max_entries': 100000,
  'channel_affinity_setting.default_ttl_seconds': 3600,
  'channel_affinity_setting.rules': '[]',
  CheckSensitiveEnabled: false,
  CheckSensitiveOnPromptEnabled: false,
  SensitiveWords: '',
  'content_safety_setting.review_mode': 'off',
  'content_safety_setting.review_model': '',
  'content_safety_setting.review_group': 'default',
  'content_safety_setting.review_prompt': '',
  'content_safety_setting.review_tool_results': true,
  'content_safety_setting.review_timeout_seconds': 15,
  'content_safety_setting.review_max_concurrency': 16,
  'content_safety_setting.review_rate_limit_per_minute': 120,
  'content_safety_setting.unit_chars': 2000,
  'content_safety_setting.max_units': 16,
  'content_safety_setting.async_workers': 4,
  'content_safety_setting.async_queue_size': 2000,
  'content_safety_setting.async_rate_per_minute': 300,
  'content_safety_setting.pass_log_percent': 10,
  'content_safety_setting.sync_all': false,
  'content_safety_setting.sync_new_user_days': 3,
  'content_safety_setting.sync_groups': '',
  'content_safety_setting.cache_ttl_seconds': 86400,
  'content_safety_setting.log_retention_days': 30,
  'content_safety_setting.risk_half_life_hours': 168,
  'content_safety_setting.risk_points_unsafe': 40,
  'content_safety_setting.risk_points_controversial': 5,
  'content_safety_setting.risk_zero_tolerance_categories': 'sexual_minors',
  'content_safety_setting.risk_watch_threshold': 20,
  'content_safety_setting.risk_restrict_threshold': 50,
  'content_safety_setting.risk_block_threshold': 100,
  'content_safety_setting.risk_restrict_rpm': 10,
  'content_safety_setting.risk_notify_enabled': true,
}
