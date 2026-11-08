package contentsafety

import (
	"maps"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// maxCollectedField skips string values large enough to be inline media.
const maxCollectedField = 64 * 1024

// CollectJSONText joins every string value of a JSON document, one per line,
// with object keys visited in sorted order so the result is stable. Inline
// media (data: URLs and oversized values) is skipped. A body that is not JSON
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
		if len(v) > maxCollectedField || strings.HasPrefix(v, "data:") {
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
