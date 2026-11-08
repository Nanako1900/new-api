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
// user: new log rows, balance changes and session lifecycle events.
func MonitorStream(c *gin.Context) {
	identity, ok := middleware.GetMonitorIdentity(c)
	hub := monitorstream.ActiveHub()
	if !ok || hub == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "code": "MONITOR_STREAM_UNAVAILABLE", "message": http.StatusText(http.StatusServiceUnavailable)})
		return
	}
	subscriber, err := hub.Subscribe(identity.UserID)
	if err != nil {
		c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "code": "MONITOR_STREAM_LIMIT", "message": http.StatusText(http.StatusTooManyRequests)})
		return
	}
	defer hub.Unsubscribe(subscriber)

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
			_, _, err := service.ValidateMonitorAccess(identity)
			switch {
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
	_ = monitorstream.Serve(c.Request.Context(), out, flush, subscriber, source, monitorstream.DefaultStreamOptions(since, time.Now()))
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
