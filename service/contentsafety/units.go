package contentsafety

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
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
// normalized (see NormalizeReviewText). Context is the user's preceding
// message: the reviewer reads it to notice a conversation working toward
// harm, but judges only Text. Key is the verdict cache key of both; the
// preceding message is fixed history, so the key still holds on later turns.
type Unit struct {
	Role    string
	Text    string
	Context string
	Key     string
}

// MaxRequestUnits bounds the units of one request looked up in the verdict
// cache: the newest ones. Older text is left unreviewed and counts as
// truncated, like new units beyond max_units, so a huge history costs a
// bounded amount of work before any quota check.
const MaxRequestUnits = 1000

// BuildUnits turns messages in conversation order into review units, newest
// first, so a cap on how many units are reviewed always covers the latest
// turns. Consecutive messages of one role merge, a message longer than
// chunkRunes is cut into overlapping chunks, and units with the same key
// appear once. keyOf gives the cache key of a unit text and its context. At
// most MaxRequestUnits units are returned; the second result is how many
// older chunks were left out.
func BuildUnits(messages []Message, chunkRunes int, keyOf func(text, context string) string) ([]Unit, int) {
	type run struct {
		role, text, context string
	}
	var runs []run
	var current strings.Builder
	role := ""
	for _, message := range messages {
		text := strings.TrimSpace(NormalizeReviewText(message.Text))
		if text == "" {
			continue
		}
		if current.Len() > 0 && message.Role != role {
			runs = append(runs, run{role: role, text: current.String()})
			current.Reset()
		}
		if current.Len() > 0 {
			current.WriteByte('\n')
		}
		role = message.Role
		current.WriteString(text)
	}
	if current.Len() > 0 {
		runs = append(runs, run{role: role, text: current.String()})
	}
	previousUser := ""
	for i := range runs {
		runs[i].context = previousUser
		if runs[i].role == RoleUser {
			runes := []rune(runs[i].text)
			previousUser = string(runes[max(0, len(runes)-contextRunes):])
		}
	}

	size := max(1, chunkRunes)
	overlap := min(chunkOverlap, size/4)
	units := make([]Unit, 0, min(len(runs), MaxRequestUnits))
	seen := make(map[string]bool, cap(units))
	truncated := 0
	for i := len(runs) - 1; i >= 0; i-- {
		if len(units) == MaxRequestUnits {
			truncated += chunkCount(utf8.RuneCountInString(runs[i].text), size, overlap)
			continue
		}
		runes := []rune(runs[i].text)
		for chunk := chunkCount(len(runes), size, overlap) - 1; chunk >= 0; chunk-- {
			if len(units) == MaxRequestUnits {
				truncated += chunk + 1
				break
			}
			start := chunk * (size - overlap)
			text := string(runes[start:min(len(runes), start+size)])
			key := keyOf(text, runs[i].context)
			if seen[key] {
				continue
			}
			seen[key] = true
			units = append(units, Unit{Role: runs[i].role, Text: text, Context: runs[i].context, Key: key})
		}
	}
	return units, truncated
}

// SampledForReview reports whether a shadow review at percent reads the unit
// with key sent by userId. The choice is a hash of both under the server
// secret: an account's text is always in or out of the sample however often
// its conversation resends it, so the reviewer calls scale with percent,
// while a text many accounts send is in the sample of some of them. Raising
// percent only adds texts. Without a configured CRYPTO_SECRET or
// SESSION_SECRET the secret, and so the sample, changes when the process
// restarts.
func SampledForReview(userId int, key string, percent int) bool {
	if percent >= 100 {
		return true
	}
	if percent <= 0 {
		return false
	}
	mac := hmac.New(sha256.New, []byte("content review sample\x00"+common.CryptoSecret))
	mac.Write([]byte(strconv.Itoa(userId) + "\x00" + key))
	return binary.BigEndian.Uint64(mac.Sum(nil))%100 < uint64(percent)
}

// chunkCount is how many chunks of at most size runes a text of length runes
// is cut into when consecutive chunks share overlap runes: chunk i starts at
// i*(size-overlap), and the last one ends with the text.
func chunkCount(length, size, overlap int) int {
	if length <= size {
		return 1
	}
	stride := size - overlap
	return (length-size+stride-1)/stride + 1
}
