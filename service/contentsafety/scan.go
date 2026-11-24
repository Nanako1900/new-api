// Package contentsafety holds the request-independent parts of the request
// content check: zero-tolerance keyword scanning, review units, reviewer
// prompts and verdicts, the verdict cache, review limits and the background
// review queue. relay/content_safety.go wires them into the relay paths.
package contentsafety

import (
	"slices"
	"unicode"

	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

// SnippetRadius is how many runes around a hit a stored log excerpt keeps.
const SnippetRadius = 100

// Window is a stretch of request text around one or more word hits. Offsets
// are rune offsets into the normalized text; HitStart and HitEnd bound the
// first hit inside the window.
type Window struct {
	Start    int
	End      int
	HitStart int
	HitEnd   int
	Text     string
	Words    []string
}

// BlockListActive reports whether the zero-tolerance word list checks prompts.
func BlockListActive() bool {
	return setting.ShouldCheckPromptSensitive() && len(setting.SensitiveWords) > 0
}

// Active reports whether any tier of the request content check runs.
func Active() bool {
	return BlockListActive() || operation_setting.GetContentSafetySetting().ReviewActive()
}

// Scan matches the normalized text against the block list, ignoring letter
// case and the width and zero-width tricks NormalizeReviewText removes. Each
// hit gets a window of SnippetRadius runes around it, and overlapping windows
// merge.
func Scan(text string, blockWords []string) []Window {
	if len(blockWords) == 0 || text == "" {
		return nil
	}
	runes := []rune(NormalizeReviewText(text))
	lower := make([]rune, len(runes))
	for i, r := range runes {
		lower[i] = unicode.ToLower(r)
	}
	words := make([]string, 0, len(blockWords))
	for _, word := range blockWords {
		words = append(words, NormalizeReviewText(word))
	}
	return windowsAround(runes, service.AcMatches(lower, words), SnippetRadius)
}

// windowsAround turns hits into context windows. Overlapping hits merge while
// the merged window stays within 4*radius plus the word length, so a dense
// text yields several bounded windows instead of one spanning everything.
func windowsAround(runes []rune, matches []service.AcMatch, radius int) []Window {
	if len(matches) == 0 {
		return nil
	}
	slices.SortFunc(matches, func(a, b service.AcMatch) int { return a.Pos - b.Pos })
	windows := make([]Window, 0, len(matches))
	for _, match := range matches {
		wordLen := len([]rune(match.Word))
		hitEnd := min(len(runes), match.Pos+wordLen)
		start := max(0, match.Pos-radius)
		end := min(len(runes), hitEnd+radius)
		if n := len(windows); n > 0 && start <= windows[n-1].End && max(windows[n-1].End, end)-windows[n-1].Start <= 4*radius+wordLen {
			last := &windows[n-1]
			last.End = max(last.End, end)
			if !slices.Contains(last.Words, match.Word) {
				last.Words = append(last.Words, match.Word)
			}
			continue
		}
		windows = append(windows, Window{Start: start, End: end, HitStart: match.Pos, HitEnd: hitEnd, Words: []string{match.Word}})
	}
	for i := range windows {
		windows[i].Text = string(runes[windows[i].Start:windows[i].End])
	}
	return windows
}

// Snippet returns the window text within radius runes of its first hit.
func (w Window) Snippet(radius int) string {
	radius = max(0, radius)
	runes := []rune(w.Text)
	start := max(0, w.HitStart-w.Start-radius)
	end := min(len(runes), w.HitEnd-w.Start+radius)
	return string(runes[start:end])
}

// Words lists each matched word once, in first-seen order.
func Words(windows []Window) []string {
	var words []string
	for _, window := range windows {
		for _, word := range window.Words {
			if !slices.Contains(words, word) {
				words = append(words, word)
			}
		}
	}
	return words
}
