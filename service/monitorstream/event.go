// Package monitorstream pushes a user's new log rows and balance changes to
// their open monitor console streams (SSE) within about a second.
//
// Every stored log row passes model's log-created hook; rows of users with an
// open stream on this node are delivered through the in-process Hub, and when
// Redis is enabled rows of users streaming on another node are forwarded over
// Redis pub/sub. Only the owner's view of a row (no admin or channel details)
// ever leaves the node that stored it.
package monitorstream

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// Event is one stored log row on its way to its owner's monitor streams. Log
// is already the owner's view with the stored id cleared; Key is the stable
// dedupe key the client sees instead of the id.
type Event struct {
	UserID int       `json:"user_id"`
	Key    string    `json:"key"`
	Log    model.Log `json:"log"`
}

// NewEvent turns a stored row into the event its owner's streams receive.
func NewEvent(stored model.Log) Event {
	view := model.FormatUserLogView(stored)
	view.Id = 0
	return Event{UserID: stored.UserId, Key: logKey(stored.Id, view), Log: view}
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
