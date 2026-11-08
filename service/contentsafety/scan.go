// Package contentsafety holds the request-independent parts of the prompt
// content safety check: keyword scanning, reviewer prompts and verdicts, the
// verdict cache and review rate limits. relay/content_safety.go wires them
// into the relay paths.
package contentsafety

import (
	"slices"
	"unicode"

	"github.com/QuantumNous/new-api/service"
)

// SnippetRadius is how many runes around a hit a stored log excerpt keeps.
const SnippetRadius = 100

// Window is a stretch of request text around one or more word hits. Offsets
// are rune offsets into the scanned text; HitStart and HitEnd bound the first
// hit inside the window.
type Window struct {
	Start    int
	End      int
	HitStart int
	HitEnd   int
	Text     string
	Words    []string
}

// Result is the keyword verdict for one request text. Blocked windows reject
// the request; Review windows need an AI verdict; both empty means pass.
type Result struct {
	Blocked []Window
	Review  []Window
}

// Scan matches text against the block list and, when no block word matches,
// against the review list. Review windows extend reviewRadius runes around
// each hit, and overlapping windows merge.
func Scan(text string, blockWords, reviewWords []string, reviewRadius int) Result {
	runes := []rune(text)
	lower := make([]rune, len(runes))
	for i, r := range runes {
		lower[i] = unicode.ToLower(r)
	}
	if blocked := windowsAround(runes, service.AcMatches(lower, blockWords), SnippetRadius); len(blocked) > 0 {
		return Result{Blocked: blocked}
	}
	return Result{Review: windowsAround(runes, service.AcMatches(lower, reviewWords), reviewRadius)}
}

// windowsAround turns sorted hits into merged context windows.
func windowsAround(runes []rune, matches []service.AcMatch, radius int) []Window {
	if len(matches) == 0 {
		return nil
	}
	slices.SortFunc(matches, func(a, b service.AcMatch) int { return a.Pos - b.Pos })
	windows := make([]Window, 0, len(matches))
	for _, match := range matches {
		hitEnd := match.Pos + len([]rune(match.Word))
		start := max(0, match.Pos-radius)
		end := min(len(runes), hitEnd+radius)
		if n := len(windows); n > 0 && start <= windows[n-1].End {
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
