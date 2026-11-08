package controller

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"slices"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// Monitor console preferences: the dashboard layout, widget settings and
// theme the user picked in the console, stored in the user setting so they
// follow the user to other devices. The monitor credential can write this
// and nothing else. The server checks the shape and size only; what the
// widget ids, setting keys and theme ids mean is up to the console, which
// validates them again when it reads them back.
const (
	monitorPreferencesVersion    = 1
	monitorPreferencesMaxBytes   = 8 * 1024
	monitorPreferencesMaxWidgets = 32
	monitorPreferencesMaxKeys    = 16
	monitorPreferencesMaxCell    = 256
)

var (
	monitorPreferenceIDPattern    = regexp.MustCompile(`^[a-z][a-z0-9-]{0,31}$`)
	monitorPreferenceKeyPattern   = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9]{0,31}$`)
	monitorPreferenceValuePattern = regexp.MustCompile(`^[a-z0-9-]{1,32}$`)
	monitorThemeModes             = []string{"auto", "light", "dark"}
)

type monitorLayoutItem struct {
	I string `json:"i"`
	X int    `json:"x"`
	Y int    `json:"y"`
	W int    `json:"w"`
	H int    `json:"h"`
}

type monitorTheme struct {
	ID   string `json:"id"`
	Mode string `json:"mode"`
}

type monitorPreferences struct {
	Version  int                       `json:"version"`
	Layout   []monitorLayoutItem       `json:"layout"`
	Settings map[string]map[string]any `json:"settings"`
	Theme    monitorTheme              `json:"theme"`
}

// valid reports whether the preferences have the stored shape: version 1, a
// layout of uniquely named whole-cell items, widget settings that are
// booleans or short lowercase tokens, and a theme id with a known mode.
func (p *monitorPreferences) valid() bool {
	if p.Version != monitorPreferencesVersion || p.Layout == nil || len(p.Layout) > monitorPreferencesMaxWidgets {
		return false
	}
	seen := make(map[string]bool, len(p.Layout))
	for _, item := range p.Layout {
		if !monitorPreferenceIDPattern.MatchString(item.I) || seen[item.I] {
			return false
		}
		seen[item.I] = true
		// Each value is bounded before the sums, which could otherwise overflow.
		if item.X < 0 || item.Y < 0 || item.W < 1 || item.H < 1 ||
			item.X > monitorPreferencesMaxCell || item.Y > monitorPreferencesMaxCell ||
			item.W > monitorPreferencesMaxCell || item.H > monitorPreferencesMaxCell ||
			item.X+item.W > monitorPreferencesMaxCell || item.Y+item.H > monitorPreferencesMaxCell {
			return false
		}
	}
	if len(p.Settings) > monitorPreferencesMaxWidgets {
		return false
	}
	for widget, values := range p.Settings {
		if !monitorPreferenceIDPattern.MatchString(widget) || len(values) > monitorPreferencesMaxKeys {
			return false
		}
		for key, value := range values {
			if !monitorPreferenceKeyPattern.MatchString(key) {
				return false
			}
			switch typed := value.(type) {
			case bool:
			case string:
				if !monitorPreferenceValuePattern.MatchString(typed) {
					return false
				}
			default:
				return false
			}
		}
	}
	return monitorPreferenceIDPattern.MatchString(p.Theme.ID) && slices.Contains(monitorThemeModes, p.Theme.Mode)
}

// writeMonitorPreferences answers with the stored preferences: the JSON the
// console saved, or null when it never saved any.
func writeMonitorPreferences(c *gin.Context, stored json.RawMessage) {
	var preferences any
	if len(stored) > 0 {
		preferences = stored
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": gin.H{"preferences": preferences}})
}

// rejectMonitorPreferences answers a malformed or oversized body. It is a
// validation failure, not an authentication event, and is logged as such.
func rejectMonitorPreferences(c *gin.Context, status int, code string, reason string) {
	logger.LogWarn(c.Request.Context(), common.LogText("monitor preferences rejected: %s; user=%d ip=%s", reason, c.GetInt("id"), c.ClientIP()))
	c.JSON(status, gin.H{"success": false, "code": code, "message": http.StatusText(status)})
}

// GetMonitorPreferences returns the console preferences of the monitor user.
func GetMonitorPreferences(c *gin.Context) {
	setting, err := model.GetUserSetting(c.GetInt("id"), false)
	if err != nil {
		writeMonitorError(c, err)
		return
	}
	writeMonitorPreferences(c, setting.MonitorPreferences)
}

// UpdateMonitorPreferences replaces the console preferences of the monitor
// user after checking their shape. Unknown fields are dropped; the rest of
// the user setting is kept as it is.
func UpdateMonitorPreferences(c *gin.Context) {
	// Read the whole body: a decoder stops after the first value and would let
	// trailing bytes past the size limit go unnoticed.
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, monitorPreferencesMaxBytes))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			rejectMonitorPreferences(c, http.StatusRequestEntityTooLarge, "MONITOR_REQUEST_TOO_LARGE", "body over the size limit")
			return
		}
		rejectMonitorPreferences(c, http.StatusBadRequest, "MONITOR_REQUEST_INVALID", "unreadable body")
		return
	}
	var preferences monitorPreferences
	if err := common.Unmarshal(body, &preferences); err != nil {
		rejectMonitorPreferences(c, http.StatusBadRequest, "MONITOR_REQUEST_INVALID", "not a preferences object")
		return
	}
	if !preferences.valid() {
		rejectMonitorPreferences(c, http.StatusBadRequest, "MONITOR_REQUEST_INVALID", "shape check failed")
		return
	}
	if preferences.Settings == nil {
		preferences.Settings = map[string]map[string]any{}
	}
	stored, err := common.Marshal(preferences)
	if err != nil {
		writeMonitorError(c, err)
		return
	}

	userID := c.GetInt("id")
	user, err := model.GetUserById(userID, true)
	if err != nil {
		writeMonitorError(c, err)
		return
	}
	// A read-modify-write of the whole setting, like the other setting writers.
	setting := user.GetSetting()
	setting.MonitorPreferences = stored
	if err := model.UpdateUserSetting(userID, setting); err != nil {
		writeMonitorError(c, err)
		return
	}
	writeMonitorPreferences(c, setting.MonitorPreferences)
}
