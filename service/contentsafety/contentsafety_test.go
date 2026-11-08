package contentsafety_test

import (
	"testing"

	"github.com/QuantumNous/new-api/service/contentsafety"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func windowTexts(windows []contentsafety.Window) []string {
	texts := make([]string, len(windows))
	for i, window := range windows {
		texts[i] = window.Text
	}
	return texts
}

func TestScanSortsTextIntoBlockReviewOrPass(t *testing.T) {
	for _, tc := range []struct {
		name        string
		text        string
		block       []string
		review      []string
		radius      int
		wantBlocked []string
		wantWindows []string
	}{
		{name: "no match passes", text: "hello world", block: []string{"bomb"}, review: []string{"knife"}, radius: 3, wantWindows: []string{}},
		{name: "a block word wins over a review word", text: "a Bomb and a knife", block: []string{"bomb"}, review: []string{"knife"}, radius: 3, wantBlocked: []string{"bomb"}, wantWindows: []string{}},
		{name: "window keeps radius runes of CJK context", text: "我想买一把刀切菜", review: []string{"刀"}, radius: 2, wantWindows: []string{"一把刀切菜"}},
		{name: "matching ignores case but keeps original text", text: "use a KNIFE now", review: []string{"knife"}, radius: 2, wantWindows: []string{"a KNIFE n"}},
		{name: "overlapping windows merge", text: "knife and knife", review: []string{"knife"}, radius: 4, wantWindows: []string{"knife and knife"}},
		{name: "distant hits stay separate", text: "knife ........ knife", review: []string{"knife"}, radius: 1, wantWindows: []string{"knife ", " knife"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := contentsafety.Scan(tc.text, tc.block, tc.review, tc.radius)
			assert.Equal(t, tc.wantBlocked, contentsafety.Words(result.Blocked))
			assert.Equal(t, tc.wantWindows, windowTexts(result.Review))
		})
	}
}

func TestWindowSnippetCentersOnFirstHit(t *testing.T) {
	result := contentsafety.Scan("0123456789knife0123456789", nil, []string{"knife"}, 8)
	require.Len(t, result.Review, 1)
	assert.Equal(t, "89knife01", result.Review[0].Snippet(2))
}

func TestWordsListsEachMatchedWordOnce(t *testing.T) {
	result := contentsafety.Scan("knife, gun and another knife far far far far away gun", nil, []string{"knife", "gun"}, 2)
	assert.ElementsMatch(t, []string{"knife", "gun"}, contentsafety.Words(result.Review))
}
