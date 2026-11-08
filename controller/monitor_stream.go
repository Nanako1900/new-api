package controller

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/monitorstream"
	"github.com/gin-gonic/gin"
)

const monitorStreamWriteTimeout = 10 * time.Second

// MonitorStream serves the live event stream (SSE) of the signed-in monitor
// user: new log rows, balance changes and session lifecycle events. With
// scope=global it streams every user's request rows to the root user instead.
func MonitorStream(c *gin.Context) {
	identity, ok := middleware.GetMonitorIdentity(c)
	hub := monitorstream.ActiveHub()
	if !ok || hub == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "code": "MONITOR_STREAM_UNAVAILABLE", "message": http.StatusText(http.StatusServiceUnavailable)})
		return
	}
	scope := c.Query("scope")
	if scope != "" && scope != "global" {
		writeMonitorError(c, errMonitorRequestInvalid)
		return
	}
	global := scope == "global"
	if global && !middleware.AllowMonitorGlobal(c) {
		return
	}
	subscribe := hub.Subscribe
	if global {
		subscribe = hub.SubscribeGlobal
	}
	subscriber, err := subscribe(identity.UserID)
	if err != nil {
		c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "code": "MONITOR_STREAM_LIMIT", "message": http.StatusText(http.StatusTooManyRequests)})
		return
	}
	defer hub.Unsubscribe(subscriber)

	if global {
		logger.LogInfo(c.Request.Context(), common.LogText("monitor global stream opened: user=%d ip=%s", identity.UserID, c.ClientIP()))
	}

	since, _ := strconv.ParseInt(c.Query("since"), 10, 64)
	header := c.Writer.Header()
	header.Set("Content-Type", "text/event-stream")
	header.Set("Cache-Control", "no-store")
	header.Set("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)

	responseController := http.NewResponseController(c.Writer)
	flush := func() error {
		c.Writer.Flush()
		return nil
	}
	out := monitorStreamWriter{writer: c.Writer, controller: responseController}
	source := monitorstream.StreamSource{
		SessionState: func() monitorstream.SessionState {
			_, user, err := service.ValidateMonitorAccess(identity)
			switch {
			case err == nil && global && user.Role < common.RoleRootUser:
				return monitorstream.SessionForbidden
			case err == nil:
				return monitorstream.SessionActive
			case errors.Is(err, service.ErrMonitorSessionInvalid):
				return monitorstream.SessionEnded
			}
			logger.LogError(c.Request.Context(), common.LogText("monitor stream revalidation error: %v", err))
			return monitorstream.SessionUnknown
		},
		Quota: func() (int, error) { return model.GetUserQuota(identity.UserID, false) },
		Replay: func(since int64, limit int) ([]*model.Log, error) {
			return model.GetUserLogsSince(identity.UserID, since, limit)
		},
	}
	options := monitorstream.DefaultStreamOptions(since, time.Now())
	if global {
		source.Replay = model.GetGlobalLogsSince
		// Name each channel once per replay.
		channelNames := map[int]string{}
		source.ReplayEvent = func(stored model.Log) monitorstream.Event {
			name, ok := channelNames[stored.ChannelId]
			if !ok && stored.ChannelId != 0 {
				if channel, err := model.CacheGetChannel(stored.ChannelId); err == nil {
					name = channel.Name
				}
				channelNames[stored.ChannelId] = name
			}
			return monitorstream.NewGlobalStreamEvent(stored, name)
		}
		options = monitorstream.GlobalStreamOptions(since, time.Now())
	}
	_ = monitorstream.Serve(c.Request.Context(), out, flush, subscriber, source, options)
}

// monitorStreamWriter bounds every write, so a client that stops reading is
// dropped instead of holding the stream open.
type monitorStreamWriter struct {
	writer     gin.ResponseWriter
	controller *http.ResponseController
}

func (w monitorStreamWriter) Write(p []byte) (int, error) {
	if err := w.controller.SetWriteDeadline(time.Now().Add(monitorStreamWriteTimeout)); err != nil && !errors.Is(err, http.ErrNotSupported) {
		return 0, err
	}
	return w.writer.Write(p)
}
