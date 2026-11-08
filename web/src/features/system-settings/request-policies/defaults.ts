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
// Options of the content safety review tier, stored as
// `content_safety_setting.*`. The block-word tier keeps FilteringSettings.
export type ContentSafetySettings = {
  'content_safety_setting.review_enabled': boolean
  'content_safety_setting.review_words': string
  'content_safety_setting.review_model': string
  'content_safety_setting.review_group': string
  'content_safety_setting.review_prompt': string
  'content_safety_setting.review_timeout_seconds': number
  'content_safety_setting.review_max_concurrency': number
  'content_safety_setting.review_rate_limit_per_minute': number
  'content_safety_setting.window_chars': number
  'content_safety_setting.max_windows': number
  'content_safety_setting.cache_ttl_seconds': number
  'content_safety_setting.log_retention_days': number
}
export type RequestPolicySettings = RetrySettings &
  HealthSettings &
  FilteringSettings &
  ContentSafetySettings &
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
  'content_safety_setting.review_enabled': false,
  'content_safety_setting.review_words': '',
  'content_safety_setting.review_model': '',
  'content_safety_setting.review_group': 'default',
  'content_safety_setting.review_prompt': '',
  'content_safety_setting.review_timeout_seconds': 15,
  'content_safety_setting.review_max_concurrency': 16,
  'content_safety_setting.review_rate_limit_per_minute': 30,
  'content_safety_setting.window_chars': 300,
  'content_safety_setting.max_windows': 20,
  'content_safety_setting.cache_ttl_seconds': 86400,
  'content_safety_setting.log_retention_days': 30,
}
