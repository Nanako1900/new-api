package contentsafety

import (
	"maps"
	"regexp"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// rawBase64MinLen is the shortest whitespace-free base64 run treated as inline media.
const rawBase64MinLen = 256

var base64DataURL = regexp.MustCompile(`^data:[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+(;[A-Za-z0-9._+=-]+)*;base64,[A-Za-z0-9+/=_-]*$`)

// CollectJSONText joins every string value of a JSON document, one per line,
// with object keys visited in sorted order so the result is stable. Inline
// media (see isInlineMedia) is skipped; every other value is scanned. A body that is not JSON
// is returned unchanged so it is still scanned.
func CollectJSONText(body []byte) string {
	var document any
	if err := common.Unmarshal(body, &document); err != nil {
		return string(body)
	}
	var builder strings.Builder
	collectStrings(document, &builder)
	return builder.String()
}

func collectStrings(value any, builder *strings.Builder) {
	switch v := value.(type) {
	case string:
		if isInlineMedia(v) {
			return
		}
		builder.WriteString(v)
		builder.WriteByte('\n')
	case []any:
		for _, item := range v {
			collectStrings(item, builder)
		}
	case map[string]any:
		for _, key := range slices.Sorted(maps.Keys(v)) {
			collectStrings(v[key], builder)
		}
	}
}

// isInlineMedia reports whether s is a base64 data URL or a long run of
// base64 characters, the two shapes binary payloads take inside JSON. Anything
// else, however large, is text a user could have written.
func isInlineMedia(s string) bool {
	if base64DataURL.MatchString(s) {
		return true
	}
	if len(s) < rawBase64MinLen {
		return false
	}
	for i := range len(s) {
		c := s[i]
		isBase64 := c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' ||
			c == '+' || c == '/' || c == '=' || c == '-' || c == '_'
		if !isBase64 {
			return false
		}
	}
	return true
}
