package dto

import "encoding/json"

type UserSetting struct {
	NotifyType                       string          `json:"notify_type,omitempty"`                          // QuotaWarningType 额度预警类型
	QuotaWarningThreshold            float64         `json:"quota_warning_threshold,omitempty"`              // QuotaWarningThreshold 额度预警阈值
	QuotaWarningEnabled              *bool           `json:"quota_warning_enabled,omitempty"`                // 是否接收余额不足提醒，未设置时接收
	WebhookUrl                       string          `json:"webhook_url,omitempty"`                          // WebhookUrl webhook地址
	WebhookSecret                    string          `json:"webhook_secret,omitempty"`                       // WebhookSecret webhook密钥
	NotificationEmail                string          `json:"notification_email,omitempty"`                   // NotificationEmail 通知邮箱地址
	BarkUrl                          string          `json:"bark_url,omitempty"`                             // BarkUrl Bark推送URL
	GotifyUrl                        string          `json:"gotify_url,omitempty"`                           // GotifyUrl Gotify服务器地址
	GotifyToken                      string          `json:"gotify_token,omitempty"`                         // GotifyToken Gotify应用令牌
	GotifyPriority                   int             `json:"gotify_priority"`                                // GotifyPriority Gotify消息优先级
	UpstreamModelUpdateNotifyEnabled bool            `json:"upstream_model_update_notify_enabled,omitempty"` // 是否接收上游模型更新定时检测通知（仅管理员）
	ChannelNotifyEnabled             *bool           `json:"channel_notify_enabled,omitempty"`               // 是否接收渠道通知（仅管理员），未设置时 root 接收、其他管理员不接收
	AcceptUnsetRatioModel            bool            `json:"accept_unset_model_ratio_model,omitempty"`       // AcceptUnsetRatioModel 是否接受未设置价格的模型
	RecordIpLog                      bool            `json:"record_ip_log,omitempty"`                        // 是否记录请求和错误日志IP
	SidebarModules                   string          `json:"sidebar_modules,omitempty"`                      // SidebarModules 左侧边栏模块配置
	BillingPreference                string          `json:"billing_preference,omitempty"`                   // BillingPreference 扣费策略（订阅/钱包）
	Language                         string          `json:"language,omitempty"`                             // Language 用户语言偏好 (zh, en)
	Avatar                           *UserAvatar     `json:"avatar,omitempty"`                               // Avatar 用户自选头像，为空时前端按用户 ID 生成默认头像
	MonitorPreferences               json.RawMessage `json:"monitor_preferences,omitempty"`                  // MonitorPreferences 用户监控台偏好（布局、模块设置、配色），由监控台写入、服务端校验过结构的 JSON
}

// UserAvatar 用户自选头像：捏好的猫（部件 ID）或上传的图片（data URL）。
type UserAvatar struct {
	Kind  string            `json:"kind"`
	Cat   map[string]string `json:"cat,omitempty"`
	Image string            `json:"image,omitempty"`
}

var (
	NotifyTypeEmail   = "email"   // Email 邮件
	NotifyTypeWebhook = "webhook" // Webhook
	NotifyTypeBark    = "bark"    // Bark 推送
	NotifyTypeGotify  = "gotify"  // Gotify 推送
)
