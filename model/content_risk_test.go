package model

import (
	"fmt"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// One hour half-life, so a score halves between two events an hour apart.
var contentRiskTestThresholds = RiskThresholds{HalfLifeSeconds: 3600, Watch: 20, Restrict: 50, Block: 100}

const contentRiskTestStart = int64(1_800_000_000)

func recordContentRiskEvent(t *testing.T, event RiskEvent) RiskEventResult {
	t.Helper()
	if event.Now == 0 {
		event.Now = contentRiskTestStart
	}
	event.Thresholds = contentRiskTestThresholds
	result, err := RecordRiskEvent(event)
	require.NoError(t, err)
	return result
}

func storedRiskProfile(t *testing.T, userId int) UserRiskProfile {
	t.Helper()
	var profile UserRiskProfile
	require.NoError(t, DB.First(&profile, "user_id = ?", userId).Error)
	return profile
}

func TestUserRiskProfilesDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useUserIDTestDB(t, dialect)
			t.Run("points decay by half each half-life", func(t *testing.T) {
				first := recordContentRiskEvent(t, RiskEvent{UserId: 501, Unsafe: true, Points: 40})
				assert.Equal(t, RiskEventResult{Before: 0, After: 40}, RiskEventResult{Before: first.Before, After: first.After})
				second := recordContentRiskEvent(t, RiskEvent{UserId: 501, Points: 5, Now: contentRiskTestStart + 3600})
				assert.InDelta(t, 20, second.Before, 1e-9)
				assert.InDelta(t, 25, second.After, 1e-9)
				profile := storedRiskProfile(t, 501)
				assert.InDelta(t, 25, profile.Score, 1e-9)
				assert.Equal(t, contentRiskTestStart+3600, profile.ScoreAt)
				assert.Equal(t, 1, profile.UnsafeCount)
				assert.Equal(t, 1, profile.ControversialCount)
				assert.Equal(t, RiskLevelWatch, profile.Level(contentRiskTestStart+3600, contentRiskTestThresholds))
				assert.Equal(t, RiskLevelNormal, profile.Level(contentRiskTestStart+2*3600, contentRiskTestThresholds), "watch recovers on its own")
				assert.False(t, profile.Blocked)
			})
			t.Run("reaching the block threshold blocks until a reset", func(t *testing.T) {
				var results []RiskEventResult
				for range 3 {
					results = append(results, recordContentRiskEvent(t, RiskEvent{UserId: 502, Unsafe: true, Points: 40}))
				}
				assert.Equal(t, []bool{false, false, true}, []bool{results[0].NewlyBlocked, results[1].NewlyBlocked, results[2].NewlyBlocked})
				profile := storedRiskProfile(t, 502)
				assert.True(t, profile.Blocked)
				assert.Equal(t, RiskBlockedReasonScore, profile.BlockedReason)
				assert.Equal(t, RiskLevelBlocked, profile.Level(contentRiskTestStart+30*3600, contentRiskTestThresholds), "a block outlives the decay")
				assert.False(t, recordContentRiskEvent(t, RiskEvent{UserId: 502, Points: 5}).NewlyBlocked)

				require.NoError(t, ResetUserRiskProfile(502))
				profile = storedRiskProfile(t, 502)
				assert.False(t, profile.Blocked)
				assert.Zero(t, profile.BlockedAt)
				assert.Empty(t, profile.BlockedReason)
				assert.Zero(t, profile.Score)
				assert.Equal(t, 3, profile.UnsafeCount, "a reset keeps the counts")
				assert.Equal(t, 1, profile.ControversialCount)
				assert.Equal(t, RiskLevelNormal, profile.Level(contentRiskTestStart, contentRiskTestThresholds))
			})
			t.Run("a zero-tolerance category blocks at once", func(t *testing.T) {
				result := recordContentRiskEvent(t, RiskEvent{UserId: 503, Unsafe: true, Points: 40, ZeroTolerance: true, Category: "sexual_minors"})
				assert.True(t, result.NewlyBlocked)
				assert.Equal(t, "zero_tolerance:sexual_minors", storedRiskProfile(t, 503).BlockedReason)
			})
			t.Run("the shadow score never blocks", func(t *testing.T) {
				result := recordContentRiskEvent(t, RiskEvent{UserId: 504, Shadow: true, Unsafe: true, Points: 40, ZeroTolerance: true, Category: "sexual_minors"})
				assert.True(t, result.NewlyBlocked, "it records that an enforced review would have blocked")
				profile := storedRiskProfile(t, 504)
				assert.False(t, profile.Blocked)
				assert.Zero(t, profile.Score)
				assert.InDelta(t, 40, profile.ShadowScore, 1e-9)
				assert.Equal(t, contentRiskTestStart, profile.ShadowZeroToleranceAt)
				assert.True(t, profile.WouldBlock(contentRiskTestStart, contentRiskTestThresholds))
				assert.Equal(t, RiskLevelBlocked, profile.ShadowLevel(contentRiskTestStart, contentRiskTestThresholds))
				assert.Equal(t, RiskLevelNormal, profile.Level(contentRiskTestStart, contentRiskTestThresholds))
			})
			t.Run("trust is written both ways", func(t *testing.T) {
				require.NoError(t, SetUserRiskTrusted(505, true))
				assert.True(t, storedRiskProfile(t, 505).Trusted)
				require.NoError(t, SetUserRiskTrusted(505, false))
				assert.False(t, storedRiskProfile(t, 505).Trusted)
				missing, err := GetUserRiskProfile(599)
				require.NoError(t, err)
				assert.Equal(t, RiskLevelNormal, missing.Level(contentRiskTestStart, contentRiskTestThresholds))
			})
			t.Run("concurrent events on a new profile are all counted", func(t *testing.T) {
				const writers = 8
				errs := make([]error, writers)
				start := make(chan struct{})
				var wg sync.WaitGroup
				for i := range writers {
					wg.Go(func() {
						<-start
						_, errs[i] = RecordRiskEvent(RiskEvent{UserId: 506, Unsafe: true, Points: 1, Now: contentRiskTestStart, Thresholds: contentRiskTestThresholds})
					})
				}
				close(start)
				wg.Wait()
				for _, err := range errs {
					require.NoError(t, err)
				}
				profile := storedRiskProfile(t, 506)
				assert.Equal(t, writers, profile.UnsafeCount)
				assert.InDelta(t, writers, profile.Score, 1e-9)
			})
			t.Run("the list filters levels as the scores decay", func(t *testing.T) {
				ids := map[string]int{"watch": 601, "blocked": 602, "restrict": 603, "normal": 604, "root": 605, "shadow": 606}
				for name, id := range ids {
					role := common.RoleCommonUser
					if name == "root" {
						role = common.RoleRootUser
					}
					require.NoError(t, DB.Create(&User{Id: id, Username: "risk-" + name, Role: role, AffCode: fmt.Sprintf("risk-%d", id)}).Error)
				}
				recordContentRiskEvent(t, RiskEvent{UserId: ids["watch"], Unsafe: true, Points: 25})
				recordContentRiskEvent(t, RiskEvent{UserId: ids["blocked"], Unsafe: true, Points: 40, ZeroTolerance: true, Category: "weapons"})
				recordContentRiskEvent(t, RiskEvent{UserId: ids["restrict"], Unsafe: true, Points: 60})
				recordContentRiskEvent(t, RiskEvent{UserId: ids["normal"], Points: 5})
				recordContentRiskEvent(t, RiskEvent{UserId: ids["root"], Unsafe: true, Points: 60})
				recordContentRiskEvent(t, RiskEvent{UserId: ids["shadow"], Shadow: true, Unsafe: true, Points: 120})
				require.NoError(t, SetUserRiskTrusted(ids["normal"], true))
				list := func(filter UserRiskProfileFilter, now int64, viewerRole int) []string {
					rows, total, err := ListUserRiskProfiles(filter, contentRiskTestThresholds, now, 0, 100, viewerRole)
					require.NoError(t, err)
					names := make([]string, 0, len(rows))
					for _, row := range rows {
						if row.UserId >= 601 && row.UserId <= 606 {
							names = append(names, row.Username)
						}
					}
					assert.EqualValues(t, len(rows), total)
					return names
				}
				admin := common.RoleAdminUser
				assert.Equal(t, []string{"risk-blocked", "risk-restrict", "risk-watch", "risk-normal", "risk-shadow"},
					list(UserRiskProfileFilter{}, contentRiskTestStart, admin), "blocked first, then the riskiest; root is hidden")
				assert.Equal(t, []string{"risk-blocked", "risk-restrict", "risk-root"}, list(UserRiskProfileFilter{}, contentRiskTestStart, common.RoleRootUser)[:3])
				for level, want := range map[string][]string{
					RiskLevelBlocked:  {"risk-blocked"},
					RiskLevelRestrict: {"risk-restrict"},
					RiskLevelWatch:    {"risk-watch"},
					RiskLevelNormal:   {"risk-normal", "risk-shadow"},
				} {
					assert.Equal(t, want, list(UserRiskProfileFilter{Level: level}, contentRiskTestStart, admin), level)
				}
				later := contentRiskTestStart + 3600
				assert.Equal(t, []string{"risk-restrict"}, list(UserRiskProfileFilter{Level: RiskLevelWatch}, later, admin), "60 decays to 30 and 25 to 12.5")
				assert.Equal(t, []string{"risk-shadow"}, list(UserRiskProfileFilter{Level: RiskLevelBlocked, Shadow: true}, contentRiskTestStart, admin))
				assert.Equal(t, []string{"risk-shadow"}, list(UserRiskProfileFilter{Level: RiskLevelRestrict, Shadow: true}, later, admin), "120 decays to 60")
				trusted, untrusted := true, false
				assert.Equal(t, []string{"risk-normal"}, list(UserRiskProfileFilter{Trusted: &trusted}, contentRiskTestStart, admin))
				assert.NotContains(t, list(UserRiskProfileFilter{Trusted: &untrusted}, contentRiskTestStart, admin), "risk-normal")
				assert.Equal(t, []string{"risk-restrict"}, list(UserRiskProfileFilter{Username: "restr"}, contentRiskTestStart, admin))
				assert.Empty(t, list(UserRiskProfileFilter{UserId: ids["root"]}, contentRiskTestStart, admin))
			})
		})
	}
}
