package contentsafety

import (
	"slices"
	"strings"
)

// Message roles as review units name them. RoleMeta holds request text that
// is no conversation turn: tool and schema definitions, legacy prompts and
// the whole text of formats without messages.
const (
	RoleSystem    = "system"
	RoleUser      = "user"
	RoleAssistant = "assistant"
	RoleTool      = "tool"
	RoleMeta      = "meta"
)

const (
	// chunkOverlap is how many runes consecutive chunks of a long message
	// share, so text cut at a chunk edge is still read whole once.
	chunkOverlap = 200
	// contextRunes bounds the earlier user text shown with a unit.
	contextRunes = 500
)

// Message is one message-sized piece of request text in conversation order.
type Message struct {
	Role string
	Text string
}

// Unit is one chunk of review text the reviewer judges on its own. Text is
// normalized (see NormalizeReviewText) and Key is its verdict cache key.
// Context is the user's preceding message: the reviewer reads it to notice a
// conversation working toward harm, but judges only Text.
type Unit struct {
	Role    string
	Text    string
	Context string
	Key     string
}

// BuildUnits turns messages in conversation order into review units, newest
// first, so a cap on how many units are reviewed always covers the latest
// turns. Consecutive messages of one role merge, a message longer than
// chunkRunes is cut into overlapping chunks, and units with the same key
// appear once. keyOf gives the cache key of a unit text.
func BuildUnits(messages []Message, chunkRunes int, keyOf func(text string) string) []Unit {
	merged := make([]Message, 0, len(messages))
	for _, message := range messages {
		text := strings.TrimSpace(NormalizeReviewText(message.Text))
		if text == "" {
			continue
		}
		if n := len(merged); n > 0 && merged[n-1].Role == message.Role {
			merged[n-1].Text += "\n" + text
			continue
		}
		merged = append(merged, Message{Role: message.Role, Text: text})
	}
	var units []Unit
	previousUser := ""
	for _, message := range merged {
		for _, chunk := range chunkText(message.Text, chunkRunes) {
			units = append(units, Unit{Role: message.Role, Text: chunk, Context: previousUser})
		}
		if message.Role == RoleUser {
			runes := []rune(message.Text)
			previousUser = string(runes[max(0, len(runes)-contextRunes):])
		}
	}
	slices.Reverse(units)
	seen := make(map[string]bool, len(units))
	unique := units[:0]
	for _, unit := range units {
		unit.Key = keyOf(unit.Text)
		if seen[unit.Key] {
			continue
		}
		seen[unit.Key] = true
		unique = append(unique, unit)
	}
	return unique
}

// chunkText cuts text into pieces of at most size runes that overlap by
// chunkOverlap runes (a quarter of size when size is small).
func chunkText(text string, size int) []string {
	runes := []rune(text)
	size = max(1, size)
	if len(runes) <= size {
		return []string{text}
	}
	overlap := min(chunkOverlap, size/4)
	var chunks []string
	for start := 0; ; start += size - overlap {
		end := min(len(runes), start+size)
		chunks = append(chunks, string(runes[start:end]))
		if end == len(runes) {
			return chunks
		}
	}
}
