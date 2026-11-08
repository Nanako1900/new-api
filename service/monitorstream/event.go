// Package monitorstream pushes a user's new log rows and balance changes to
// their open monitor console streams (SSE) within about a second.
//
// Every stored log row passes model's log-created hook; rows of users with an
// open stream on this node are delivered through the in-process Hub, and when
// Redis is enabled rows of users streaming on another node are forwarded over
// Redis pub/sub. A row leaves the node that stored it only as its owner's view
// (no admin or channel details), plus the site-wide view while the root user
// streams the whole site (scope=global) on another node. Bridge messages are
// signed, not encrypted: the Redis server must be trusted infrastructure.
package monitorstream

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// Event is one stored log row on its way to its owner's monitor streams. Log
// is already the owner's view with the stored id cleared; Key is the stable
// dedupe key the client sees instead of the id. Global is the site-wide view
// of the row, set only while a site-wide stream is open. An event without a
// row (UserID 0) only crosses the bridge, to report in Dropped the request
// rows another node left out of site-wide streams.
type Event struct {
	UserID  int        `json:"user_id"`
	Key     string     `json:"key"`
	Log     model.Log  `json:"log"`
	Global  *model.Log `json:"global,omitempty"`
	Dropped int64      `json:"dropped,omitempty"`
}

// NewEvent turns a stored row into the event its owner's streams receive.
func NewEvent(stored model.Log) Event {
	view := model.FormatUserLogView(stored)
	view.Id = 0
	return Event{UserID: stored.UserId, Key: logKey(stored.Id, view), Log: view}
}

// WithGlobalView returns a copy of the event that also carries the site-wide
// view of stored, the row it was made from.
func (e Event) WithGlobalView(stored model.Log, channelName string) Event {
	view := model.FormatGlobalLogView(stored)
	view.Id = 0
	view.ChannelName = channelName
	e.Global = &view
	return e
}

// siteWide is the event as a site-wide stream sends it: the site-wide view in
// Log. Call it only on an event that carries one.
func (e Event) siteWide() Event {
	return Event{UserID: e.UserID, Key: e.Key, Log: *e.Global}
}

// NewGlobalStreamEvent is the event a site-wide stream sends for stored, such
// as a replayed row: the site-wide view, keyed like the live row.
func NewGlobalStreamEvent(stored model.Log, channelName string) Event {
	return NewEvent(stored).WithGlobalView(stored, channelName).siteWide()
}

// logKey identifies a row across live delivery and replay without revealing
// its database id. ClickHouse rows carry no id, so their key covers the whole
// owner's view; two identical rows then share a key and display once.
func logKey(storedID int, view model.Log) string {
	material := "id:" + strconv.Itoa(storedID)
	if storedID <= 0 {
		payload, err := common.Marshal(view)
		if err != nil {
			common.SysError(common.LogText("failed to encode a monitor log row: %s", err.Error()))
		}
		material = "row:" + string(payload)
	}
	return common.GenerateHMACWithKey([]byte("monitor-log-key-v1:"+common.SessionSecret), material)[:22]
}
