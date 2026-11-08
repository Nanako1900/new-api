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

// rawMediaMinLen is the shortest raw base64 run examined for a media signature.
const rawMediaMinLen = 1024

// mediaHeader matches the header of a base64 data URL for image, video or audio.
var mediaHeader = regexp.MustCompile(`(?i)^data:(image|video|audio)/[a-z0-9.+-]+(;[a-z0-9._+=-]+)*;base64$`)

// mediaMagics are the leading bytes of the media formats accepted as raw
// base64: bytes at offset must equal magic.
var mediaMagics = []struct {
	offset int
	magic  string
}{
	{0, "\x89PNG\r\n\x1a\n"},
	{0, "\xFF\xD8\xFF"},
	{0, "GIF87a"},
	{0, "GIF89a"},
	{0, "RIFF"}, // WEBP or WAVE follows at offset 8, checked in hasMediaMagic
	{4, "ftyp"},
	{0, "ID3"},
	{0, "\xFF\xFB"},
	{0, "\xFF\xF3"},
	{0, "\xFF\xF2"},
	{0, "OggS"},
	{0, "fLaC"},
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
// base64 data URL with a media type, or a long raw base64 run that starts with
// a known media signature. Alphabet alone never qualifies, because prompts
// written in snake_case or camelCase share it. Everything else, however large,
// is text a user could have written.
func isInlineMedia(s string) bool {
	if header, payload, ok := strings.Cut(s, ","); ok {
		return mediaHeader.MatchString(header) && isBase64Payload(payload, true)
	}
	return len(s) >= rawMediaMinLen && isBase64Payload(s, false) && hasMediaMagic(s)
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

// hasMediaMagic decodes the first 32 characters of a raw base64 run and
// compares them with the known media signatures.
func hasMediaMagic(s string) bool {
	head := strings.TrimRight(s[:32], "=")
	head = head[:len(head)/4*4]
	decoded, err := base64.RawStdEncoding.DecodeString(head)
	if err != nil {
		decoded, err = base64.RawURLEncoding.DecodeString(head)
		if err != nil {
			return false
		}
	}
	for _, m := range mediaMagics {
		if !bytes.HasPrefix(decoded[min(m.offset, len(decoded)):], []byte(m.magic)) {
			continue
		}
		if m.magic != "RIFF" {
			return true
		}
		if kind := decoded[min(8, len(decoded)):]; bytes.HasPrefix(kind, []byte("WEBP")) || bytes.HasPrefix(kind, []byte("WAVE")) {
			return true
		}
	}
	return false
}
