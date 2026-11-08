package controller

import (
	"bytes"
	"encoding/base64"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"

	"github.com/gin-gonic/gin"
	_ "golang.org/x/image/webp"
)

const (
	userAvatarKindCat    = "cat"
	userAvatarKindUpload = "upload"
	// The browser crops and compresses uploads to a small square before sending them;
	// the avatar is stored inside the user setting text column, so it must stay small.
	maxAvatarImageBytes = 24 * 1024
	maxAvatarImageSide  = 512
	minAvatarImageSide  = 16
	maxAvatarBodyBytes  = 64 * 1024
)

// avatarImageFormats maps the accepted data URL prefixes to the decoded image format.
// SVG is never accepted: it can carry scripts.
var avatarImageFormats = map[string]string{
	"data:image/png;base64,":  "png",
	"data:image/jpeg;base64,": "jpeg",
	"data:image/webp;base64,": "webp",
}

// avatarCatParts lists the part names a built cat may set. Part values are ids
// owned by the frontend catalog, so new parts or options need no backend change.
var avatarCatParts = map[string]bool{
	"coat":           true,
	"pattern":        true,
	"ear":            true,
	"eye":            true,
	"eyeLeft":        true,
	"eyeRight":       true,
	"mouth":          true,
	"cheeks":         true,
	"accessory":      true,
	"accessoryColor": true,
	"background":     true,
}

var avatarPartIdPattern = regexp.MustCompile(`^[a-z0-9-]{1,32}$`)

type updateUserAvatarRequest struct {
	Kind  string            `json:"kind"`
	Cat   map[string]string `json:"cat"`
	Image string            `json:"image"`
}

// normalizeUserAvatar validates a requested avatar and returns the value to store.
// The returned message is an i18n key describing why the avatar was rejected.
func normalizeUserAvatar(req updateUserAvatarRequest) (*dto.UserAvatar, string) {
	switch req.Kind {
	case userAvatarKindCat:
		if len(req.Cat) == 0 {
			return nil, "Invalid avatar"
		}
		cat := make(map[string]string, len(req.Cat))
		for part, id := range req.Cat {
			if !avatarCatParts[part] || !avatarPartIdPattern.MatchString(id) {
				return nil, "Invalid avatar"
			}
			cat[part] = id
		}
		return &dto.UserAvatar{Kind: userAvatarKindCat, Cat: cat}, ""
	case userAvatarKindUpload:
		return normalizeAvatarImage(req.Image)
	default:
		return nil, "Invalid avatar"
	}
}

func normalizeAvatarImage(dataURL string) (*dto.UserAvatar, string) {
	for prefix, format := range avatarImageFormats {
		encoded, ok := strings.CutPrefix(dataURL, prefix)
		if !ok {
			continue
		}
		if base64.StdEncoding.DecodedLen(len(encoded)) > maxAvatarImageBytes+3 {
			return nil, "Avatar image is too large"
		}
		raw, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil || len(raw) == 0 {
			return nil, "Unsupported avatar image"
		}
		if len(raw) > maxAvatarImageBytes {
			return nil, "Avatar image is too large"
		}
		config, decodedFormat, err := image.DecodeConfig(bytes.NewReader(raw))
		if err != nil || decodedFormat != format {
			return nil, "Unsupported avatar image"
		}
		if config.Width < minAvatarImageSide || config.Height < minAvatarImageSide ||
			config.Width > maxAvatarImageSide || config.Height > maxAvatarImageSide {
			return nil, "Unsupported avatar image"
		}
		return &dto.UserAvatar{
			Kind:  userAvatarKindUpload,
			Image: prefix + base64.StdEncoding.EncodeToString(raw),
		}, ""
	}
	return nil, "Unsupported avatar image"
}

func saveUserAvatar(c *gin.Context, userId int, avatar *dto.UserAvatar) bool {
	user, err := model.GetUserById(userId, true)
	if err != nil {
		common.ApiError(c, err)
		return false
	}
	settings := user.GetSetting()
	settings.Avatar = avatar
	if err := model.UpdateUserSetting(userId, settings); err != nil {
		common.ApiError(c, err)
		return false
	}
	return true
}

// UpdateSelfAvatar saves the avatar the user built or uploaded.
func UpdateSelfAvatar(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxAvatarBodyBytes)
	var req updateUserAvatarRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Avatar image is too large")
		return
	}
	avatar, rejection := normalizeUserAvatar(req)
	if avatar == nil {
		common.ApiErrorT(c, rejection)
		return
	}
	if !saveUserAvatar(c, c.GetInt("id"), avatar) {
		return
	}
	common.ApiSuccess(c, gin.H{"avatar": avatar})
}

// ResetSelfAvatar goes back to the default avatar generated from the user id.
func ResetSelfAvatar(c *gin.Context) {
	if !saveUserAvatar(c, c.GetInt("id"), nil) {
		return
	}
	common.ApiSuccess(c, gin.H{"avatar": nil})
}

// AdminResetUserAvatar lets an administrator remove an unsuitable avatar.
func AdminResetUserAvatar(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorT(c, "Invalid user ID")
		return
	}
	target, err := model.GetUserById(id, false)
	if err != nil {
		common.ApiErrorT(c, "User does not exist")
		return
	}
	if !canManageTargetRole(c.GetInt("role"), target.Role) {
		common.ApiErrorMsg(c, "no permission")
		return
	}
	if !saveUserAvatar(c, id, nil) {
		return
	}
	recordManageAuditFor(c, id, "user.reset_avatar", map[string]any{
		"username": target.Username,
		"id":       target.Id,
	})
	common.ApiSuccess(c, gin.H{"avatar": nil})
}
