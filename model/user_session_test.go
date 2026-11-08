package model

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/alicebob/miniredis/v2"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type setMiniRedisTimeOnEvalHook struct {
	server *miniredis.Miniredis
	at     time.Time
}

func (hook setMiniRedisTimeOnEvalHook) BeforeProcess(ctx context.Context, cmd redis.Cmder) (context.Context, error) {
	if cmd.Name() == "eval" {
		hook.server.SetTime(hook.at)
	}
	return ctx, nil
}

func (setMiniRedisTimeOnEvalHook) AfterProcess(context.Context, redis.Cmder) error {
	return nil
}

func (setMiniRedisTimeOnEvalHook) BeforeProcessPipeline(ctx context.Context, _ []redis.Cmder) (context.Context, error) {
	return ctx, nil
}

func (setMiniRedisTimeOnEvalHook) AfterProcessPipeline(context.Context, []redis.Cmder) error {
	return nil
}

func setupUserSessionTest(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&User{}, &UserSession{}))
	require.NoError(t, DB.Exec("DELETE FROM user_sessions").Error)
	oldRedisEnabled := common.RedisEnabled
	oldActiveLimit := common.UserSessionActiveLimit
	oldIssuanceLimit := common.UserSessionIssuanceLimit
	oldIssuanceWindow := common.UserSessionIssuanceWindowSeconds
	oldRevokedRetention := common.UserSessionRevokedRetentionDays
	common.RedisEnabled = false
	common.UserSessionActiveLimit = common.DefaultUserSessionActiveLimit
	common.UserSessionIssuanceLimit = common.DefaultUserSessionIssuanceLimit
	common.UserSessionIssuanceWindowSeconds = int64(common.DefaultUserSessionIssuanceWindowSeconds)
	common.UserSessionRevokedRetentionDays = common.DefaultUserSessionRevokedRetentionDays
	t.Cleanup(func() {
		common.RedisEnabled = oldRedisEnabled
		common.UserSessionActiveLimit = oldActiveLimit
		common.UserSessionIssuanceLimit = oldIssuanceLimit
		common.UserSessionIssuanceWindowSeconds = oldIssuanceWindow
		common.UserSessionRevokedRetentionDays = oldRevokedRetention
	})
}

func createUserSessionTestUser(t *testing.T, userID int, authVersion int64) {
	t.Helper()
	user := User{
		Id:          userID,
		Username:    fmt.Sprintf("user-session-%d", userID),
		Password:    "unused",
		Status:      common.UserStatusEnabled,
		Role:        common.RoleCommonUser,
		Group:       "default",
		AffCode:     fmt.Sprintf("session-aff-%d", userID),
		AuthVersion: authVersion,
	}
	require.NoError(t, DB.Create(&user).Error)
	t.Cleanup(func() { _ = DB.Unscoped().Delete(&User{}, userID).Error })
}

func newTestUserSession(sid string, userID int, now int64) *UserSession {
	return &UserSession{
		SID:             sid,
		UserID:          userID,
		Version:         1,
		UserAuthVersion: 1,
		Status:          UserSessionStatusActive,
		RefreshHash:     fmt.Sprintf("current-%s", sid),
		LoginMethod:     "password",
		IP:              "127.0.0.1",
		UserAgent:       "model-test",
		CreatedAt:       now,
		LastActiveAt:    now,
		ExpiresAt:       now + int64((30*24*time.Hour)/time.Second),
	}
}

func newTestMonitorSession(sid, parentSID string, userID int, now int64) *UserSession {
	session := newTestUserSession(sid, userID, now)
	session.Kind = UserSessionKindMonitor
	session.ParentSID = parentSID
	session.LoginMethod = "monitor_sso"
	return session
}

func TestUserSessionKindAndParentSurviveDatabaseAndCache(t *testing.T) {
	setupUserSessionTest(t)
	useUserCacheMiniRedis(t)
	now := time.Now().Unix()
	createUserSessionTestUser(t, 1021, 1)
	parent := newTestUserSession("kind-parent", 1021, now)
	child := newTestMonitorSession("kind-child", parent.SID, 1021, now)
	require.NoError(t, CreateUserSession(parent))
	require.NoError(t, CreateUserSession(child))

	stored, err := GetUserSessionBySID(child.SID)
	require.NoError(t, err)
	assert.Equal(t, UserSessionKindMonitor, stored.Kind)
	assert.Equal(t, parent.SID, stored.ParentSID)

	entry, err := getUserSessionCache(child.SID)
	require.NoError(t, err)
	cached := entry.session()
	assert.Equal(t, UserSessionKindMonitor, cached.Kind)
	assert.Equal(t, parent.SID, cached.ParentSID)

	dashboard, err := GetUserSessionCached(parent.SID)
	require.NoError(t, err)
	assert.Equal(t, UserSessionKindDashboard, dashboard.Kind)
	assert.Empty(t, dashboard.ParentSID)
}

// legacyUserSessionCacheEntry is the cache layout written before sessions had
// a kind. During a rolling deploy older nodes still write it.
type legacyUserSessionCacheEntry struct {
	SID             string
	UserID          int
	Version         int64
	UserAuthVersion int64
	Status          string
	LoginMethod     string
	IP              string
	UserAgent       string
	CreatedAt       int64
	LastActiveAt    int64
	ExpiresAt       int64
	RevokedAt       int64
	RevokedReason   string
	CacheSchema     int
	CacheExpiresAt  int64
	CacheMAC        string `json:"-"`
}

func TestLegacySessionCacheEntryCannotHideMonitorKind(t *testing.T) {
	setupUserSessionTest(t)
	useUserCacheMiniRedis(t)
	now := time.Now().Unix()
	createUserSessionTestUser(t, 1022, 1)
	child := newTestMonitorSession("legacy-cache-child", "legacy-cache-parent", 1022, now)
	require.NoError(t, createUserSessionWithTx(DB, child))

	cacheKey := userSessionCacheKey(child.SID)
	legacy := legacyUserSessionCacheEntry{
		SID: child.SID, UserID: child.UserID, Version: child.Version, UserAuthVersion: child.UserAuthVersion,
		Status: child.Status, LoginMethod: child.LoginMethod, IP: child.IP, UserAgent: child.UserAgent,
		CreatedAt: child.CreatedAt, LastActiveAt: child.LastActiveAt, ExpiresAt: child.ExpiresAt,
		CacheSchema: 1, CacheExpiresAt: time.Now().Add(time.Minute).UnixMilli(),
	}
	mac, err := authCacheMAC(cacheKey, legacy)
	require.NoError(t, err)
	require.NoError(t, common.RDB.HSet(context.Background(), cacheKey, map[string]any{
		"SID": legacy.SID, "UserID": legacy.UserID, "Version": legacy.Version, "UserAuthVersion": legacy.UserAuthVersion,
		"Status": legacy.Status, "LoginMethod": legacy.LoginMethod, "IP": legacy.IP, "UserAgent": legacy.UserAgent,
		"CreatedAt": legacy.CreatedAt, "LastActiveAt": legacy.LastActiveAt, "ExpiresAt": legacy.ExpiresAt,
		"RevokedAt": legacy.RevokedAt, "RevokedReason": legacy.RevokedReason, "CacheSchema": legacy.CacheSchema,
		"CacheExpiresAt": legacy.CacheExpiresAt, "CacheMAC": mac,
	}).Err())

	session, err := GetUserSessionCached(child.SID)
	require.NoError(t, err)
	assert.Equal(t, UserSessionKindMonitor, session.Kind, "a cache entry without a kind must fall back to the database")
	assert.Equal(t, child.ParentSID, session.ParentSID)
}

func TestRevokingParentSessionRevokesItsMonitorSessions(t *testing.T) {
	tests := []struct {
		name   string
		revoke func(t *testing.T, parent *UserSession, now int64)
	}{
		{name: "revoke by sid", revoke: func(t *testing.T, parent *UserSession, _ int64) {
			revoked, err := RevokeUserSession(parent.UserID, parent.SID, "user_revoked")
			require.NoError(t, err)
			require.True(t, revoked)
		}},
		{name: "logout by refresh secret", revoke: func(t *testing.T, parent *UserSession, _ int64) {
			revoked, err := RevokeUserSessionByRefreshHash(parent.SID, parent.RefreshHash, "logout")
			require.NoError(t, err)
			require.True(t, revoked)
		}},
		{name: "refresh token reuse", revoke: func(t *testing.T, parent *UserSession, now int64) {
			_, err := RotateUserSessionRefresh(parent.UserID, parent.SID, parent.RefreshHash, "next-"+parent.SID, now, 30*time.Second)
			require.NoError(t, err)
			_, err = RotateUserSessionRefresh(parent.UserID, parent.SID, parent.RefreshHash, "again-"+parent.SID, now+31, 30*time.Second)
			require.ErrorIs(t, err, ErrUserSessionRefreshReuse)
		}},
	}
	for i, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			setupUserSessionTest(t)
			useUserCacheMiniRedis(t)
			now := time.Now().Unix()
			userID := 1030 + i
			createUserSessionTestUser(t, userID, 1)
			parent := newTestUserSession(fmt.Sprintf("cascade-parent-%d", i), userID, now)
			sibling := newTestUserSession(fmt.Sprintf("cascade-sibling-%d", i), userID, now)
			child := newTestMonitorSession(fmt.Sprintf("cascade-child-%d", i), parent.SID, userID, now)
			siblingChild := newTestMonitorSession(fmt.Sprintf("cascade-sibling-child-%d", i), sibling.SID, userID, now)
			for _, session := range []*UserSession{parent, sibling, child, siblingChild} {
				require.NoError(t, CreateUserSession(session))
			}
			_, err := getUserSessionCache(child.SID)
			require.NoError(t, err, "the child starts with an active cache entry")

			test.revoke(t, parent, now)

			storedChild, err := GetUserSessionBySID(child.SID)
			require.NoError(t, err)
			assert.Equal(t, UserSessionStatusRevoked, storedChild.Status)
			assert.Equal(t, UserSessionRevokedReasonParent, storedChild.RevokedReason)
			_, err = getUserSessionCache(child.SID)
			assert.ErrorIs(t, err, ErrUserSessionInactive, "the cascade must replace the child's active cache entry with a tombstone")
			for _, sid := range []string{sibling.SID, siblingChild.SID} {
				stored, err := GetUserSessionBySID(sid)
				require.NoError(t, err)
				assert.Equal(t, UserSessionStatusActive, stored.Status, sid)
			}
		})
	}
}

func TestMonitorSessionCascadeReachesDatabaseWhenRedisFails(t *testing.T) {
	setupUserSessionTest(t)
	server := useUserCacheMiniRedis(t)
	now := time.Now().Unix()
	createUserSessionTestUser(t, 1036, 1)
	parent := newTestUserSession("redis-down-parent", 1036, now)
	child := newTestMonitorSession("redis-down-child", parent.SID, 1036, now)
	require.NoError(t, CreateUserSession(parent))
	require.NoError(t, CreateUserSession(child))
	server.Close()

	revokeChildUserSessions(1036, parent.SID)

	stored, err := GetUserSessionBySID(child.SID)
	require.NoError(t, err)
	assert.Equal(t, UserSessionStatusRevoked, stored.Status, "the parent revoke already committed, so the cascade must not stop at a Redis error")
}

func TestCreateUserSessionRejectsInconsistentKind(t *testing.T) {
	setupUserSessionTest(t)
	now := time.Now().Unix()
	createUserSessionTestUser(t, 1037, 1)
	tests := []struct {
		name      string
		kind      string
		parentSID string
	}{
		{name: "unknown kind", kind: "admin", parentSID: ""},
		{name: "monitor session without a parent", kind: UserSessionKindMonitor, parentSID: ""},
		{name: "dashboard session with a parent", kind: UserSessionKindDashboard, parentSID: "some-parent"},
	}
	for i, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			session := newTestUserSession(fmt.Sprintf("inconsistent-kind-%d", i), 1037, now)
			session.Kind = test.kind
			session.ParentSID = test.parentSID
			assert.ErrorIs(t, CreateUserSession(session), ErrUserSessionInvalid)
			_, err := GetUserSessionBySID(session.SID)
			assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
		})
	}
}

func TestAuthFlowSessionValidationRejectsMonitorSessions(t *testing.T) {
	setupUserSessionTest(t)
	now := time.Now().Unix()
	createUserSessionTestUser(t, 1038, 1)
	parent := newTestUserSession("flow-parent", 1038, now)
	child := newTestMonitorSession("flow-child", parent.SID, 1038, now)
	require.NoError(t, CreateUserSession(parent))
	require.NoError(t, CreateUserSession(child))

	parentIdentity := AuthSessionIdentity{UserID: 1038, SessionID: parent.SID, UserAuthVersion: 1, SessionVersion: 1}
	require.NoError(t, ValidateAuthSessionWithTx(DB, parentIdentity))
	childIdentity := AuthSessionIdentity{UserID: 1038, SessionID: child.SID, UserAuthVersion: 1, SessionVersion: 1}
	assert.ErrorIs(t, ValidateAuthSessionWithTx(DB, childIdentity), ErrUserSessionInactive, "authentication flows act for dashboard sessions only")
}

func TestUserSessionCacheTTLUsesShortCacheWindow(t *testing.T) {
	setupUserSessionTest(t)
	server := useUserCacheMiniRedis(t)
	now := time.Now().Unix()
	tests := []struct {
		name       string
		status     string
		expiresAt  int64
		wantMaxTTL time.Duration
	}{
		{name: "active", status: UserSessionStatusActive, expiresAt: now + 300, wantMaxTTL: 2 * time.Second},
		{name: "revoking", status: UserSessionStatusRevoking, expiresAt: now + 300, wantMaxTTL: 2 * time.Second},
		{name: "revoked", status: UserSessionStatusRevoked, expiresAt: now + 300, wantMaxTTL: 2 * time.Second},
		{name: "already expired", status: UserSessionStatusRevoked, expiresAt: now - 1, wantMaxTTL: time.Second},
	}

	for index, test := range tests {
		sid := fmt.Sprintf("short-cache-ttl-%d", index)
		entry := newTestUserSession(sid, 1100+index, now).cacheEntry()
		entry.Status = test.status
		entry.ExpiresAt = test.expiresAt
		if test.status != UserSessionStatusActive {
			entry.RevokedAt = now
		}

		cacheDeadline := time.Time{}
		if test.status == UserSessionStatusActive {
			cacheDeadline = userSessionCacheDeadline()
		}
		require.NoError(t, writeUserSessionCache(entry, cacheDeadline), test.name)
		ttl := server.TTL(userSessionCacheKey(sid))
		assert.Positive(t, ttl, test.name)
		assert.LessOrEqual(t, ttl, test.wantMaxTTL, test.name)
	}

	initialTTL := server.TTL(userSessionCacheKey("short-cache-ttl-0"))
	server.FastForward(time.Second)
	_, err := getUserSessionCache("short-cache-ttl-0")
	require.NoError(t, err)
	remainingTTL := server.TTL(userSessionCacheKey("short-cache-ttl-0"))
	assert.Positive(t, remainingTTL)
	assert.LessOrEqual(t, remainingTTL, initialTTL-time.Second, "cache reads must not renew the bounded TTL")

	common.SyncFrequency = 10
	nearExpiry := newTestUserSession("short-cache-ttl-near-expiry", 1199, now).cacheEntry()
	nearExpiry.ExpiresAt = time.Now().Add(2 * time.Second).Unix()
	nearExpiryDeadline := userSessionCacheDeadline()
	remainingLifetime := time.Until(time.Unix(nearExpiry.ExpiresAt, 0))
	require.NoError(t, writeUserSessionCache(nearExpiry, nearExpiryDeadline))
	nearExpiryTTL := server.TTL(userSessionCacheKey(nearExpiry.SID))
	assert.Positive(t, nearExpiryTTL)
	assert.LessOrEqual(t, nearExpiryTTL, remainingLifetime, "cache TTL must not exceed the Session remaining lifetime")

	common.SyncFrequency = 0
	fallback := newTestUserSession("short-cache-ttl-fallback", 1200, now).cacheEntry()
	fallback.ExpiresAt = now + 300
	require.NoError(t, writeUserSessionCache(fallback, userSessionCacheDeadline()))
	fallbackTTL := server.TTL(userSessionCacheKey(fallback.SID))
	assert.Greater(t, fallbackTTL, 59*time.Second)
	assert.LessOrEqual(t, fallbackTTL, 60*time.Second, "non-positive cache frequency must use the existing 60-second fallback")
}

func TestStaleActiveSessionCacheFillCannotRestartWindowAfterDenyExpires(t *testing.T) {
	setupUserSessionTest(t)
	server := useUserCacheMiniRedis(t)
	now := time.Now().Unix()
	active := newTestUserSession("stale-active-cache-fill", 1201, now).cacheEntry()
	denied := *active
	denied.Status = UserSessionStatusRevoked
	denied.RevokedAt = now
	denied.RevokedReason = "test-revoke"

	require.NoError(t, writeUserSessionCache(&denied, time.Time{}))
	cacheKey := userSessionCacheKey(active.SID)
	assert.True(t, server.Exists(cacheKey))
	server.FastForward(3 * time.Second)
	assert.False(t, server.Exists(cacheKey), "the short deny tombstone must have expired in this race setup")

	err := writeUserSessionCache(active, time.Now().Add(-time.Millisecond))
	assert.ErrorIs(t, err, errUserSessionCacheObservationStale)
	assert.False(t, server.Exists(cacheKey), "a delayed pre-revoke active snapshot must not restart a fresh cache window")
}

func TestActiveSessionCacheFillUsesRemainingObservationWindow(t *testing.T) {
	setupUserSessionTest(t)
	server := useUserCacheMiniRedis(t)
	now := time.Now().Unix()
	entry := newTestUserSession("bounded-active-cache-fill", 1202, now).cacheEntry()
	deadline := time.Now().Add(1500 * time.Millisecond)

	require.NoError(t, writeUserSessionCache(entry, deadline))
	ttl := server.TTL(userSessionCacheKey(entry.SID))
	assert.Positive(t, ttl)
	assert.LessOrEqual(t, ttl, 1500*time.Millisecond, "a delayed fill must inherit only the unused observation window")
}

func TestSessionCacheLuaUsesAbsoluteActiveAndRelativeDenyExpiry(t *testing.T) {
	setupUserSessionTest(t)
	server := useUserCacheMiniRedis(t)
	now := time.Now().Unix()
	deadline := time.Now().Add(10 * time.Second)
	common.RDB.AddHook(setMiniRedisTimeOnEvalHook{server: server, at: deadline.Add(time.Second)})

	active := newTestUserSession("delayed-active-cache-eval", 1203, now).cacheEntry()
	require.NoError(t, writeUserSessionCache(active, deadline))
	assert.False(t, server.Exists(userSessionCacheKey(active.SID)), "an active fill executed after its absolute deadline must not recreate the cache")

	denied := newTestUserSession("delayed-deny-cache-eval", 1204, now).cacheEntry()
	denied.Status = UserSessionStatusRevoked
	denied.RevokedAt = now
	denied.RevokedReason = "test-revoke"
	require.NoError(t, writeUserSessionCache(denied, time.Time{}))
	denyTTL := server.TTL(userSessionCacheKey(denied.SID))
	assert.Positive(t, denyTTL)
	assert.LessOrEqual(t, denyTTL, 2*time.Second, "a delayed deny publication must receive a full relative short TTL at Redis execution")
}

func TestUserSessionCreateListAndRevokeOne(t *testing.T) {
	setupUserSessionTest(t)
	now := time.Now().Unix()
	user := User{Id: 1001, Username: "session-list-user", Password: "password", AuthVersion: 1}
	require.NoError(t, DB.Create(&user).Error)
	t.Cleanup(func() { _ = DB.Unscoped().Delete(&User{}, user.Id).Error })
	first := newTestUserSession("session-one", 1001, now)
	second := newTestUserSession("session-two", 1001, now+1)
	require.NoError(t, CreateUserSession(first))
	require.NoError(t, CreateUserSession(second))

	sessions, err := ListActiveUserSessions(1001, first.SID, now)
	require.NoError(t, err)
	require.Len(t, sessions, 2)
	assert.Equal(t, first.SID, sessions[0].SID)

	revoked, err := RevokeUserSession(1001, first.SID, "user_revoked")
	require.NoError(t, err)
	assert.True(t, revoked)
	revoked, err = RevokeUserSession(1001, first.SID, "duplicate")
	require.NoError(t, err)
	assert.False(t, revoked)

	_, err = GetUserSessionCached(first.SID)
	assert.ErrorIs(t, err, ErrUserSessionInactive)
	active, err := GetUserSessionCached(second.SID)
	require.NoError(t, err)
	assert.Equal(t, second.SID, active.SID)
}

func TestRotateUserSessionRefreshRaceAndReuse(t *testing.T) {
	setupUserSessionTest(t)
	now := time.Now().Unix()
	createUserSessionTestUser(t, 1002, 1)
	session := newTestUserSession("rotate-session", 1002, now)
	require.NoError(t, CreateUserSession(session))

	rotated, err := RotateUserSessionRefresh(1002, session.SID, session.RefreshHash, "next-hash", now+10, 30*time.Second)
	require.NoError(t, err)
	assert.Equal(t, "next-hash", rotated.RefreshHash)
	assert.Equal(t, session.RefreshHash, rotated.PreviousRefreshHash)
	assert.Equal(t, now+40, rotated.PreviousValidUntil)

	_, err = RotateUserSessionRefresh(1002, session.SID, session.RefreshHash, "unused-hash", now+20, 30*time.Second)
	assert.ErrorIs(t, err, ErrUserSessionRefreshRace)
	_, err = RotateUserSessionRefresh(1002, session.SID, "unknown-hash", "unused-hash", now+20, 30*time.Second)
	assert.ErrorIs(t, err, ErrUserSessionRefreshInvalid)
	stored, getErr := GetUserSessionBySID(session.SID)
	require.NoError(t, getErr)
	assert.Equal(t, UserSessionStatusActive, stored.Status)

	_, err = RotateUserSessionRefresh(1002, session.SID, session.RefreshHash, "unused-hash", now+41, 30*time.Second)
	assert.ErrorIs(t, err, ErrUserSessionRefreshReuse)
	stored, getErr = GetUserSessionBySID(session.SID)
	require.NoError(t, getErr)
	assert.Equal(t, UserSessionStatusRevoked, stored.Status)
	assert.Equal(t, "refresh_reuse", stored.RevokedReason)
}

func TestUserSessionPreviousRefreshHashNormalizesLegacyPadding(t *testing.T) {
	setupUserSessionTest(t)
	now := time.Now().Unix()
	createUserSessionTestUser(t, 1010, 1)
	digest := strings.Repeat("a", 64)

	blank := newTestUserSession("legacy-blank-previous-hash", 1010, now)
	blank.PreviousRefreshHash = strings.Repeat(" ", 64)
	blank.PreviousValidUntil = now + 60
	require.NoError(t, DB.Create(blank).Error)
	loadedBlank, err := GetUserSessionBySID(blank.SID)
	require.NoError(t, err)
	assert.Empty(t, loadedBlank.PreviousRefreshHash)

	valid := newTestUserSession("legacy-valid-previous-hash", 1010, now)
	valid.RefreshHash = strings.Repeat("b", 64)
	valid.PreviousRefreshHash = digest
	valid.PreviousValidUntil = now + 60
	require.NoError(t, DB.Create(valid).Error)
	loadedValid, err := GetUserSessionBySID(valid.SID)
	require.NoError(t, err)
	assert.Equal(t, digest, loadedValid.PreviousRefreshHash)

	require.NoError(t, DB.Model(&UserSession{}).Where("sid = ?", valid.SID).
		Updates(map[string]any{
			"previous_refresh_hash": digest + "   ",
			"previous_valid_until":  now + 60,
		}).Error)
	_, err = RotateUserSessionRefresh(valid.UserID, valid.SID, digest, strings.Repeat("c", 64), now+1, 30*time.Second)
	assert.ErrorIs(t, err, ErrUserSessionRefreshRace)

	revoked, err := RevokeUserSessionByRefreshHash(valid.SID, digest, "legacy-padded-refresh-logout")
	require.NoError(t, err)
	assert.True(t, revoked, "refresh-cookie logout must accept a legacy CHAR-padded previous digest inside its grace window")
}

func TestUserSessionCacheExcludesRefreshDigests(t *testing.T) {
	setupUserSessionTest(t)
	useUserCacheMiniRedis(t)
	now := time.Now().Unix()
	session := newTestUserSession("cache-without-refresh-digests", 1011, now)
	session.PreviousRefreshHash = strings.Repeat("a", 64)
	session.PreviousValidUntil = now + 30
	require.NoError(t, writeUserSessionCache(session.cacheEntry(), userSessionCacheDeadline()))

	cacheKey := userSessionCacheKey(session.SID)
	fields, err := common.RDB.HGetAll(context.Background(), cacheKey).Result()
	require.NoError(t, err)
	assert.NotContains(t, fields, "RefreshHash")
	assert.NotContains(t, fields, "PreviousRefreshHash")
	assert.NotContains(t, fields, "PreviousValidUntil")

	require.NoError(t, common.RDB.HSet(context.Background(), cacheKey,
		"RefreshHash", strings.Repeat("b", 64),
		"PreviousRefreshHash", strings.Repeat("c", 64)+"   ",
		"PreviousValidUntil", now+30,
	).Err())
	entry, err := getUserSessionCache(session.SID)
	require.NoError(t, err)
	cachedSession := entry.session()
	assert.Empty(t, cachedSession.RefreshHash)
	assert.Empty(t, cachedSession.PreviousRefreshHash)
	assert.Zero(t, cachedSession.PreviousValidUntil)
}

func TestRevokeOtherUserSessionsKeepsCurrent(t *testing.T) {
	setupUserSessionTest(t)
	now := time.Now().Unix()
	createUserSessionTestUser(t, 1003, 1)
	createUserSessionTestUser(t, 1004, 1)
	for _, sid := range []string{"current-session", "other-one", "other-two"} {
		session := newTestUserSession(sid, 1003, now)
		if sid == "other-one" {
			session.UserAuthVersion = 99
		}
		require.NoError(t, CreateUserSession(session))
	}
	require.NoError(t, CreateUserSession(newTestMonitorSession("current-monitor", "current-session", 1003, now)))
	require.NoError(t, CreateUserSession(newTestUserSession("different-user", 1004, now)))

	count, err := RevokeOtherUserSessions(1003, "current-session", "revoke_others")
	require.NoError(t, err)
	assert.Equal(t, int64(3), count)

	current, err := GetUserSessionCached("current-session")
	require.NoError(t, err)
	assert.Equal(t, UserSessionStatusActive, current.Status)
	currentMonitor, err := GetUserSessionBySID("current-monitor")
	require.NoError(t, err)
	assert.Equal(t, UserSessionStatusRevoked, currentMonitor.Status, "a monitor session is another device even when the current session issued it")
	_, err = GetUserSessionCached("other-one")
	assert.True(t, errors.Is(err, ErrUserSessionInactive))
	stale, err := GetUserSessionBySID("other-one")
	require.NoError(t, err)
	assert.Equal(t, UserSessionStatusRevoked, stale.Status, "revocation must include active sessions from stale auth versions")
	different, err := GetUserSessionCached("different-user")
	require.NoError(t, err)
	assert.Equal(t, 1004, different.UserID)
}

func TestRevokeUserSessionByRefreshHashRequiresSecret(t *testing.T) {
	setupUserSessionTest(t)
	now := time.Now().Unix()
	createUserSessionTestUser(t, 1005, 1)
	session := newTestUserSession("refresh-logout-session", 1005, now)
	require.NoError(t, CreateUserSession(session))

	revoked, err := RevokeUserSessionByRefreshHash(session.SID, "wrong-hash", "logout")
	require.NoError(t, err)
	assert.False(t, revoked)
	active, err := GetUserSessionCached(session.SID)
	require.NoError(t, err)
	assert.Equal(t, UserSessionStatusActive, active.Status)

	revoked, err = RevokeUserSessionByRefreshHash(session.SID, session.RefreshHash, "logout")
	require.NoError(t, err)
	assert.True(t, revoked)
	_, err = GetUserSessionCached(session.SID)
	assert.ErrorIs(t, err, ErrUserSessionInactive)
}

func TestUserSessionGrowthCountsUseBroadActiveAndStrictIssuancePredicates(t *testing.T) {
	setupUserSessionTest(t)
	now := time.Now().Unix()
	createUserSessionTestUser(t, 1006, 7)
	rows := []UserSession{
		*newTestUserSession("count-current-version", 1006, now-10),
		*newTestUserSession("count-stale-version", 1006, now-9),
		*newTestUserSession("count-expired", 1006, now-8),
		*newTestUserSession("count-revoked", 1006, now-7),
		*newTestUserSession("count-cutoff", 1006, now-3600),
	}
	rows[0].UserAuthVersion = 7
	rows[1].UserAuthVersion = 2
	rows[2].UserAuthVersion = 7
	rows[2].ExpiresAt = now
	rows[3].UserAuthVersion = 7
	rows[3].Status = UserSessionStatusRevoked
	rows[3].RevokedAt = now - 1
	rows[4].UserAuthVersion = 7
	rows[4].CreatedAt = now - 3600
	rows[4].ExpiresAt = now
	require.NoError(t, DB.Create(&rows).Error)

	activeCount, err := CountActiveUserSessions(1006, now)
	require.NoError(t, err)
	assert.Equal(t, int64(2), activeCount, "active count includes stale auth versions but excludes expired and revoked rows")

	issuedCount, err := CountUserSessionsCreatedSince(1006, now-3600)
	require.NoError(t, err)
	assert.Equal(t, int64(4), issuedCount, "issuance count includes every status and uses a strict cutoff")
	globalCount, err := CountUserSessionsCreatedSince(0, now-3600)
	require.NoError(t, err)
	assert.Equal(t, issuedCount, globalCount)
}

func TestListActiveUserSessionsKeepsCurrentAndBoundsOtherSessions(t *testing.T) {
	setupUserSessionTest(t)
	now := time.Now().Unix()
	createUserSessionTestUser(t, 1007, 7)
	current := newTestUserSession("list-current", 1007, now-1000)
	current.UserAuthVersion = 7
	rows := make([]UserSession, 0, 107)
	rows = append(rows, *current)
	for i := range 105 {
		session := newTestUserSession(fmt.Sprintf("list-other-%03d", i), 1007, now-int64(i))
		session.UserAuthVersion = 7
		rows = append(rows, *session)
	}
	stale := newTestUserSession("list-stale-auth-version", 1007, now+1)
	stale.UserAuthVersion = 6
	rows = append(rows, *stale)
	require.NoError(t, DB.CreateInBatches(rows, 100).Error)

	sessions, err := ListActiveUserSessions(1007, current.SID, now)
	require.NoError(t, err)
	require.Len(t, sessions, 100)
	assert.Equal(t, current.SID, sessions[0].SID)
	for _, session := range sessions {
		assert.Equal(t, int64(7), session.UserAuthVersion)
		assert.NotEqual(t, stale.SID, session.SID)
	}

	sessionsWithoutCurrent, err := ListActiveUserSessions(1007, "missing-current", now)
	require.NoError(t, err)
	assert.Len(t, sessionsWithoutCurrent, userSessionListLimit, "a missing current SID must not reduce the total list limit")
}

func TestRevokeUserSessionsReturnsCumulativeProgressAndSupportsRetry(t *testing.T) {
	setupUserSessionTest(t)
	now := time.Now().Unix()
	createUserSessionTestUser(t, 1008, 1)
	rows := make([]UserSession, 0, userSessionRevokeBatchSize+1)
	for i := range userSessionRevokeBatchSize + 1 {
		rows = append(rows, *newTestUserSession(fmt.Sprintf("batch-revoke-%03d", i), 1008, now))
	}
	require.NoError(t, DB.CreateInBatches(rows, 100).Error)

	forcedErr := errors.New("forced second revoke batch failure")
	callbackName := "test:fail_second_user_session_revoke_batch"
	updateCalls := 0
	callbackRegistered := true
	require.NoError(t, DB.Callback().Update().Before("gorm:update").Register(callbackName, func(tx *gorm.DB) {
		if tx.Statement != nil && tx.Statement.Table == "user_sessions" {
			updateCalls++
			if updateCalls == 2 {
				tx.AddError(forcedErr)
			}
		}
	}))
	t.Cleanup(func() {
		if callbackRegistered {
			_ = DB.Callback().Update().Remove(callbackName)
		}
	})

	affected, err := RevokeAllUserSessions(1008, "batch-test")
	assert.ErrorIs(t, err, forcedErr)
	assert.Equal(t, int64(userSessionRevokeBatchSize), affected)
	require.NoError(t, DB.Callback().Update().Remove(callbackName))
	callbackRegistered = false

	retried, err := RevokeAllUserSessions(1008, "batch-test-retry")
	require.NoError(t, err)
	assert.Equal(t, int64(1), retried)
	var activeCount int64
	require.NoError(t, DB.Model(&UserSession{}).Where("user_id = ? AND status = ?", 1008, UserSessionStatusActive).Count(&activeCount).Error)
	assert.Zero(t, activeCount)
}

func TestDeleteExpiredUserSessionsLoopsInChunksAndRechecksPredicate(t *testing.T) {
	setupUserSessionTest(t)
	now := time.Now().Unix()
	common.UserSessionRevokedRetentionDays = 7
	common.UserSessionIssuanceWindowSeconds = 3600
	oldCreatedAt := now - 7200
	rows := make([]UserSession, 0, userSessionCleanupScanLimit+5)
	race := newTestUserSession("cleanup-race", 1009, now-1000)
	race.CreatedAt = oldCreatedAt
	race.ExpiresAt = now - 1000
	rows = append(rows, *race)
	for i := range userSessionCleanupScanLimit + 1 {
		session := newTestUserSession(fmt.Sprintf("cleanup-expired-%04d", i), 1009, now-100)
		session.CreatedAt = oldCreatedAt - int64(i)
		session.ExpiresAt = now - 100
		rows = append(rows, *session)
	}
	oldRevoked := newTestUserSession("cleanup-old-revoked", 1009, now-10)
	oldRevoked.CreatedAt = oldCreatedAt
	oldRevoked.Status = UserSessionStatusRevoked
	oldRevoked.RevokedAt = now - int64(8*24*time.Hour/time.Second)
	rows = append(rows, *oldRevoked)
	recentRevoked := newTestUserSession("cleanup-recent-revoked", 1009, now-9)
	recentRevoked.CreatedAt = oldCreatedAt
	recentRevoked.Status = UserSessionStatusRevoked
	recentRevoked.RevokedAt = now - int64(6*24*time.Hour/time.Second)
	recentRevoked.ExpiresAt = now - 100
	rows = append(rows, *recentRevoked)
	recentIssuedExpired := newTestUserSession("cleanup-recent-issued-expired", 1009, now-1800)
	recentIssuedExpired.ExpiresAt = now - 100
	rows = append(rows, *recentIssuedExpired)
	expiryBoundary := newTestUserSession("cleanup-expiry-boundary", 1009, now-7)
	expiryBoundary.CreatedAt = oldCreatedAt
	expiryBoundary.ExpiresAt = now
	rows = append(rows, *expiryBoundary)
	revokedBoundary := newTestUserSession("cleanup-revoked-boundary", 1009, now-6)
	revokedBoundary.CreatedAt = oldCreatedAt
	revokedBoundary.Status = UserSessionStatusRevoked
	revokedBoundary.RevokedAt = now - int64(7*24*time.Hour/time.Second)
	rows = append(rows, *revokedBoundary)
	live := newTestUserSession("cleanup-live", 1009, now-8)
	rows = append(rows, *live)
	require.NoError(t, DB.CreateInBatches(rows, 100).Error)

	callbackName := "test:recheck_user_session_cleanup_predicate"
	deleteCalls := 0
	mutated := false
	require.NoError(t, DB.Callback().Delete().Before("gorm:delete").Register(callbackName, func(tx *gorm.DB) {
		if tx.Statement == nil || tx.Statement.Table != "user_sessions" {
			return
		}
		deleteCalls++
		if !mutated {
			mutated = true
			tx.Exec("UPDATE user_sessions SET expires_at = ? WHERE sid = ?", now+3600, race.SID)
		}
	}))
	t.Cleanup(func() { _ = DB.Callback().Delete().Remove(callbackName) })

	require.NoError(t, DeleteExpiredUserSessions(now))
	require.NoError(t, DeleteOldRevokedUserSessions(now))
	assert.Equal(t, 4, deleteCalls, "expired and retained-revoked scans each delete in bounded chunks")
	var remaining []UserSession
	require.NoError(t, DB.Order("sid").Find(&remaining).Error)
	require.Len(t, remaining, 6)
	remainingSIDs := make([]string, 0, len(remaining))
	for _, session := range remaining {
		remainingSIDs = append(remainingSIDs, session.SID)
	}
	assert.ElementsMatch(t, []string{
		race.SID,
		recentRevoked.SID,
		recentIssuedExpired.SID,
		expiryBoundary.SID,
		revokedBoundary.SID,
		live.SID,
	}, remainingSIDs)
}

func TestUserSessionGrowthQueryIndexesExist(t *testing.T) {
	setupUserSessionTest(t)
	migrator := DB.Migrator()
	assert.True(t, migrator.HasIndex(&UserSession{}, "idx_user_sessions_expires_at"))
	assert.True(t, migrator.HasIndex(&UserSession{}, "idx_user_sessions_user_created"))
	assert.True(t, migrator.HasIndex(&UserSession{}, "idx_user_sessions_status_revoked"))
}

func TestUserBaseIncludesAuthorizationFields(t *testing.T) {
	user := User{
		Id:          42,
		Username:    "cache-user",
		Role:        common.RoleAdminUser,
		Status:      common.UserStatusEnabled,
		Group:       "vip",
		Quota:       123,
		AuthVersion: 7,
	}
	base := user.ToBaseUser()
	assert.Equal(t, user.Role, base.Role)
	assert.Equal(t, user.AuthVersion, base.AuthVersion)
	assert.Equal(t, userCacheSchemaVersion, base.CacheSchema)
	assert.Equal(t, user.Quota, base.Quota)
}

func TestUserUpdateBumpsAuthVersionOnlyForAuthorizationChanges(t *testing.T) {
	setupUserSessionTest(t)
	user := &User{
		Username: "auth-version-user",
		Password: "hashed-placeholder",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "default",
	}
	require.NoError(t, DB.Create(user).Error)
	t.Cleanup(func() { _ = DB.Unscoped().Delete(&User{}, user.Id).Error })
	assert.Equal(t, int64(1), user.AuthVersion)

	user.DisplayName = "profile-only"
	require.NoError(t, user.Update(false))
	assert.Equal(t, int64(1), user.AuthVersion)

	user.Group = "vip"
	require.NoError(t, user.Update(false))
	assert.Equal(t, int64(2), user.AuthVersion)

	user.Role = common.RoleAdminUser
	require.NoError(t, user.Update(false))
	assert.Equal(t, int64(3), user.AuthVersion)
}
