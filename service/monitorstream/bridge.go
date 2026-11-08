package monitorstream

import (
	"context"
	"crypto/hmac"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/go-redis/redis/v8"
)

// globalMember is the user part of a site-wide stream's advertisement. Nodes
// that predate site-wide streams fail to parse it as a user id and skip it.
const globalMember = "global"

const (
	bridgeMaintainEvery = 2 * time.Second
	bridgeOnlineTTL     = 60 * time.Second
	bridgeRedisTimeout  = 2 * time.Second
	bridgeErrorLogEvery = time.Minute
)

// bridgeMessage carries one event between nodes. MAC signs the origin and
// the event with a key derived from SESSION_SECRET, so another deployment
// sharing the Redis database cannot inject rows.
type bridgeMessage struct {
	Origin string `json:"origin"`
	Event  string `json:"event"`
	MAC    string `json:"mac"`
}

func bridgeMAC(origin, event string) string {
	return common.GenerateHMACWithKey([]byte("monitor-bridge-v1:"+common.SessionSecret), origin+"\x00"+event)
}

// bridge forwards events between nodes over Redis. Each node advertises the
// users it streams to in a sorted set (member "user:origin", score = expiry),
// plus "global:origin" while it serves a site-wide stream, so a node only
// publishes rows that another node is waiting for.
type bridge struct {
	rdb           *redis.Client
	hub           *Hub
	origin        string
	topic         string
	onlineKey     string
	maintainEvery time.Duration
	onlineTTL     time.Duration
	remote        atomic.Pointer[map[int]struct{}]
	remoteGlobal  atomic.Bool
	// advertisedGlobal is owned by the maintain loop.
	advertisedGlobal bool
	lastErrorLog     atomic.Int64
}

func newBridge(rdb *redis.Client, hub *Hub, maintainEvery, onlineTTL time.Duration) *bridge {
	name := common.NodeName
	if name == "" {
		name = "node"
	}
	// Pub/Sub crosses logical databases, so both names carry the database.
	database := rdb.Options().DB
	return &bridge{
		rdb:           rdb,
		hub:           hub,
		origin:        fmt.Sprintf("%s-%d-%d", name, os.Getpid(), time.Now().UnixNano()),
		topic:         fmt.Sprintf("new-api:monitor:events:db:%d", database),
		onlineKey:     fmt.Sprintf("new-api:monitor:online:db:%d", database),
		maintainEvery: maintainEvery,
		onlineTTL:     onlineTTL,
	}
}

func (b *bridge) run(ctx context.Context) {
	pubsub := b.rdb.Subscribe(ctx, b.topic)
	if _, err := pubsub.Receive(ctx); err != nil {
		b.logError("failed to subscribe to monitor events: %s", err)
	}
	go b.receive(ctx, pubsub)
	ticker := time.NewTicker(b.maintainEvery)
	defer ticker.Stop()
	for {
		b.maintainOnline(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (b *bridge) receive(ctx context.Context, pubsub *redis.PubSub) {
	defer pubsub.Close()
	messages := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case message, ok := <-messages:
			if !ok {
				return
			}
			var decoded bridgeMessage
			if err := common.UnmarshalJsonStr(message.Payload, &decoded); err != nil {
				b.logError("failed to decode a monitor event: %s", err)
				continue
			}
			if decoded.Origin == b.origin {
				continue
			}
			if !hmac.Equal([]byte(decoded.MAC), []byte(bridgeMAC(decoded.Origin, decoded.Event))) {
				b.logError("dropped a monitor event with an invalid signature: %s", fmt.Errorf("origin %q", decoded.Origin))
				continue
			}
			var event Event
			if err := common.UnmarshalJsonStr(decoded.Event, &event); err != nil {
				continue
			}
			if event.UserID <= 0 {
				if event.Dropped > 0 {
					b.hub.AddGlobalDropped(event.Dropped)
				}
				continue
			}
			b.hub.Deliver(event)
		}
	}
}

// maintainOnline renews this node's users in the online set, drops expired
// members and refreshes the users that stream on other nodes.
func (b *bridge) maintainOnline(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, bridgeRedisTimeout)
	defer cancel()
	now := time.Now()
	users := b.hub.Users()
	members := make([]*redis.Z, 0, len(users)+1)
	expiresAt := float64(now.Add(b.onlineTTL).Unix())
	for _, userID := range users {
		members = append(members, &redis.Z{Score: expiresAt, Member: strconv.Itoa(userID) + ":" + b.origin})
	}
	global := b.hub.HasGlobalSubscribers()
	if global {
		members = append(members, &redis.Z{Score: expiresAt, Member: globalMember + ":" + b.origin})
	}
	if len(members) > 0 {
		if err := b.rdb.ZAdd(ctx, b.onlineKey, members...).Err(); err != nil {
			b.logError("failed to advertise monitor streams: %s", err)
		}
	}
	// The last site-wide stream closed: stop the other nodes forwarding now,
	// not when the advertisement expires.
	if b.advertisedGlobal && !global {
		if err := b.rdb.ZRem(ctx, b.onlineKey, globalMember+":"+b.origin).Err(); err != nil {
			b.logError("failed to withdraw the site-wide stream advertisement: %s", err)
		}
	}
	b.advertisedGlobal = global
	nowScore := strconv.FormatInt(now.Unix(), 10)
	if err := b.rdb.ZRemRangeByScore(ctx, b.onlineKey, "-inf", "("+nowScore).Err(); err != nil {
		b.logError("failed to expire monitor stream advertisements: %s", err)
	}
	advertised, err := b.rdb.ZRangeByScore(ctx, b.onlineKey, &redis.ZRangeBy{Min: nowScore, Max: "+inf"}).Result()
	if err != nil {
		b.logError("failed to read monitor stream advertisements: %s", err)
		return
	}
	remote := make(map[int]struct{}, len(advertised))
	remoteGlobal := false
	for _, member := range advertised {
		userPart, origin, ok := strings.Cut(member, ":")
		if !ok || origin == b.origin {
			continue
		}
		if userPart == globalMember {
			remoteGlobal = true
			continue
		}
		if userID, err := strconv.Atoi(userPart); err == nil {
			remote[userID] = struct{}{}
		}
	}
	b.remote.Store(&remote)
	b.remoteGlobal.Store(remoteGlobal)
}

// globalElsewhere reports whether another node advertised a site-wide stream.
func (b *bridge) globalElsewhere() bool {
	return b.remoteGlobal.Load()
}

// streamsElsewhere reports whether another node advertised a stream of userID.
func (b *bridge) streamsElsewhere(userID int) bool {
	remote := b.remote.Load()
	if remote == nil {
		return false
	}
	_, ok := (*remote)[userID]
	return ok
}

func (b *bridge) publish(ctx context.Context, event Event) {
	encoded, err := common.Marshal(event)
	if err != nil {
		b.logError("failed to encode a monitor event: %s", err)
		return
	}
	payload, err := common.Marshal(bridgeMessage{Origin: b.origin, Event: string(encoded), MAC: bridgeMAC(b.origin, string(encoded))})
	if err != nil {
		b.logError("failed to encode a monitor event: %s", err)
		return
	}
	ctx, cancel := context.WithTimeout(ctx, bridgeRedisTimeout)
	defer cancel()
	if err := b.rdb.Publish(ctx, b.topic, payload).Err(); err != nil {
		b.logError("failed to publish a monitor event: %s", err)
	}
}

// logError logs at most once a minute, so a Redis outage cannot flood the log.
func (b *bridge) logError(format string, err error) {
	now := time.Now().UnixNano()
	last := b.lastErrorLog.Load()
	if now-last < int64(bridgeErrorLogEvery) || !b.lastErrorLog.CompareAndSwap(last, now) {
		return
	}
	common.SysError(common.LogText(format, err.Error()))
}
