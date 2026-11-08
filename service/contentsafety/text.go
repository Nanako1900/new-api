package contentsafety

import (
	"bytes"
	"encoding/base64"
	"maps"
	"regexp"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

const (
	// rawMediaMinLen and dataURLMediaMinLen are the shortest encoded payloads
	// skipped as media; shorter values are scanned.
	rawMediaMinLen     = 1024
	dataURLMediaMinLen = 256
	// maxDataURLHeader bounds the "data:...;base64" header of a media data URL.
	maxDataURLHeader = 256
	// Compressed media encoded as base64 holds about 15% digits and 40% each of
	// upper and lower case; text written in the alphabet falls far below.
	minDigitPercent = 5
	minUpperPercent = 15
	minLowerPercent = 15
)

// mediaHeader matches the header of a base64 data URL for image, video or audio.
var mediaHeader = regexp.MustCompile(`(?i)^data:(image|video|audio)/[a-z0-9.+-]+(;[a-z0-9._+=-]+)*;base64$`)

// mediaSignatures are the leading bytes of the accepted media formats. magic
// sits at offset, tag (when set) at offset 8 of a RIFF container, and families
// lists the declared data URL families the format belongs to.
var mediaSignatures = []struct {
	families string
	offset   int
	magic    string
	tag      string
}{
	{"image", 0, "\x89PNG\r\n\x1a\n", ""},
	{"image", 0, "\xFF\xD8\xFF", ""},
	{"image", 0, "GIF87a", ""},
	{"image", 0, "GIF89a", ""},
	{"image", 0, "RIFF", "WEBP"},
	{"image audio video", 4, "ftyp", ""},
	{"audio", 0, "ID3", ""},
	{"audio video", 0, "OggS", ""},
	{"audio", 0, "fLaC", ""},
	{"audio", 0, "RIFF", "WAVE"},
	{"video", 0, "RIFF", "AVI "},
	{"video", 0, "\x1A\x45\xDF\xA3", ""},
}

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

// CollectFormText joins every value of a form, one per line, with field names
// visited in sorted order so the result is stable. Inline media is skipped as
// in CollectJSONText.
func CollectFormText(values map[string][]string) string {
	var builder strings.Builder
	for _, key := range slices.Sorted(maps.Keys(values)) {
		for _, value := range values[key] {
			collectStrings(value, &builder)
		}
	}
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

// isInlineMedia reports whether s is an image, video or audio payload: a
// base64 data URL with a media type, or a raw base64 run. Either must look like
// encoded media (see looksLikeEncodedMedia); alphabet alone never qualifies,
// because prompts written in snake_case or camelCase share it. Everything
// else, however large, is text a user could have written.
func isInlineMedia(s string) bool {
	header, payload, isDataURL := strings.Cut(s, ",")
	if !isDataURL {
		return looksLikeEncodedMedia(s, "")
	}
	if len(header) > maxDataURLHeader {
		return false
	}
	match := mediaHeader.FindStringSubmatch(header)
	return match != nil && looksLikeEncodedMedia(payload, strings.ToLower(match[1]))
}

// looksLikeEncodedMedia checks a base64 payload for minimum length, the
// character statistics of compressed media and a media signature. family is
// the declared data URL family, or "" for a raw run, which accepts any family.
func looksLikeEncodedMedia(payload, family string) bool {
	if !isBase64Payload(payload, family != "") {
		return false
	}
	var total, digits, upper, lower int
	for i := range len(payload) {
		switch c := payload[i]; {
		case c >= '0' && c <= '9':
			digits++
		case c >= 'A' && c <= 'Z':
			upper++
		case c >= 'a' && c <= 'z':
			lower++
		case c == '=' || c == '\r' || c == '\n':
			continue
		}
		total++
	}
	minLen := rawMediaMinLen
	if family != "" {
		minLen = dataURLMediaMinLen
	}
	if total < minLen ||
		digits*100 < minDigitPercent*total ||
		upper*100 < minUpperPercent*total ||
		lower*100 < minLowerPercent*total {
		return false
	}
	return hasMediaMagic(payload, family)
}

// isBase64Payload checks the base64 alphabet (standard or URL-safe), with '='
// only as trailing padding and, when allowLineBreaks is set, MIME line breaks.
func isBase64Payload(s string, allowLineBreaks bool) bool {
	padding := false
	for i := range len(s) {
		c := s[i]
		switch {
		case c == '=':
			padding = true
		case allowLineBreaks && (c == '\r' || c == '\n'):
		case padding:
			return false
		case c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '+' || c == '/' || c == '-' || c == '_':
		default:
			return false
		}
	}
	return true
}

// hasMediaMagic decodes the first 32 characters of a payload and compares them
// with the signatures of family (any family when empty).
func hasMediaMagic(payload, family string) bool {
	head := strings.NewReplacer("\r", "", "\n", "").Replace(payload[:min(len(payload), 64)])
	if len(head) < 32 {
		return false
	}
	head = head[:32]
	decoded, err := base64.RawStdEncoding.DecodeString(head)
	if err != nil {
		decoded, err = base64.RawURLEncoding.DecodeString(head)
		if err != nil {
			return false
		}
	}
	for _, sig := range mediaSignatures {
		if family != "" && !slices.Contains(strings.Fields(sig.families), family) {
			continue
		}
		if !bytes.HasPrefix(decoded[min(sig.offset, len(decoded)):], []byte(sig.magic)) {
			continue
		}
		if sig.tag == "" || bytes.HasPrefix(decoded[min(8, len(decoded)):], []byte(sig.tag)) {
			return true
		}
	}
	return false
}
