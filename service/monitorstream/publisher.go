package monitorstream

import (
	"context"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

const (
	publishQueueSize = 4096
	// channelNameTTL bounds how stale a channel name on a site-wide row can be.
	channelNameTTL = time.Minute
	// A node gives at most globalBudget rows per globalBudgetWindow a
	// site-wide view, which is what one site-wide stream can show. The rest
	// are counted and reported as dropped, so a busy site neither floods
	// Redis nor crowds out the rows owners wait for.
	globalBudget       = GlobalStreamMaxBatch
	globalBudgetWindow = GlobalStreamBatchWindow
)

var activeHub atomic.Pointer[Hub]

// queuedLog is a stored row on its way to the worker. Global means the row
// was given a site-wide view within the node's budget.
type queuedLog struct {
	stored model.Log
	global bool
}

// publisher receives every stored log row from model's hook. The hook runs on
// the request goroutine, so it only checks whether anyone streams the row's
// user (or the whole site) and queues a copy; formatting and fan-out happen
// on one worker.
type publisher struct {
	hub    *Hub
	bridge *bridge
	queue  chan queuedLog
	// globalSent counts the rows given a site-wide view in the current budget
	// window; globalDropped the request rows site-wide streams missed since
	// the last report. The worker resets both every globalBudgetWindow.
	globalSent    atomic.Int64
	globalDropped atomic.Int64
	// channelNames is owned by the worker goroutine.
	channelNames map[int]channelName
}

type channelName struct {
	name      string
	fetchedAt time.Time
}

func (p *publisher) observe(stored model.Log) {
	if stored.UserId <= 0 {
		return
	}
	owner := p.ownerWanted(stored.UserId)
	global := false
	if p.globalWanted(stored) {
		if global = p.globalSent.Add(1) <= globalBudget; !global {
			p.globalDropped.Add(1)
		}
	}
	if !owner && !global {
		return
	}
	select {
	case p.queue <- queuedLog{stored: stored, global: global}:
	default:
		if owner {
			p.hub.SignalOverflow(stored.UserId)
		}
		if global {
			p.globalDropped.Add(1)
		}
	}
}

// ownerWanted reports whether a stream of userID's own rows is open on any node.
func (p *publisher) ownerWanted(userID int) bool {
	return p.hub.HasSubscribers(userID) || (p.bridge != nil && p.bridge.streamsElsewhere(userID))
}

// globalWanted reports whether the row is a request row and a site-wide
// stream is open on any node.
func (p *publisher) globalWanted(stored model.Log) bool {
	return model.IsGlobalLogType(stored.Type) && (p.hub.HasGlobalSubscribers() || (p.bridge != nil && p.bridge.globalElsewhere()))
}

func (p *publisher) run(ctx context.Context) {
	budget := time.NewTicker(globalBudgetWindow)
	defer budget.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case item := <-p.queue:
			p.deliver(ctx, item)
		case <-budget.C:
			p.globalSent.Store(0)
			p.reportGlobalDropped(ctx)
		}
	}
}

// deliver builds the row's views and hands them to this node's streams and,
// when another node waits for them, to the bridge. The site-wide view leaves
// this node only for a site-wide stream on another node.
func (p *publisher) deliver(ctx context.Context, item queuedLog) {
	event := NewEvent(item.stored)
	if item.global {
		event = event.WithGlobalView(item.stored, p.channelName(item.stored.ChannelId))
	}
	p.hub.Deliver(event)
	if p.bridge == nil {
		return
	}
	remoteGlobal := item.global && p.bridge.globalElsewhere()
	if !remoteGlobal && !p.bridge.streamsElsewhere(event.UserID) {
		return
	}
	if !remoteGlobal {
		event.Global = nil
	}
	p.bridge.publish(ctx, event)
}

// reportGlobalDropped tells the site-wide streams, here and on other nodes,
// how many request rows this node left out since the last report.
func (p *publisher) reportGlobalDropped(ctx context.Context) {
	dropped := p.globalDropped.Swap(0)
	if dropped == 0 {
		return
	}
	p.hub.AddGlobalDropped(dropped)
	if p.bridge != nil && p.bridge.globalElsewhere() {
		p.bridge.publish(ctx, Event{Dropped: dropped})
	}
}

// channelName names a channel for site-wide rows, read at most once a minute
// per channel so a busy site does not query the channel table for every row.
func (p *publisher) channelName(channelID int) string {
	if channelID == 0 {
		return ""
	}
	if cached, ok := p.channelNames[channelID]; ok && time.Since(cached.fetchedAt) < channelNameTTL {
		return cached.name
	}
	channel, err := model.CacheGetChannel(channelID)
	if err != nil {
		// Not remembered: a transient read error must not blank the name for a minute.
		return ""
	}
	if p.channelNames == nil {
		p.channelNames = map[int]channelName{}
	}
	p.channelNames[channelID] = channelName{name: channel.Name, fetchedAt: time.Now()}
	return channel.Name
}

// Start installs the log hook and, with Redis, the cross-node bridge. It does
// nothing while the monitor console is disabled. Call it once at startup after
// Redis is initialized.
func Start(ctx context.Context) {
	if !common.MonitorSSOEnabled {
		return
	}
	hub := NewHub(common.MonitorStreamMaxPerUser, common.MonitorStreamMaxPerNode)
	p := &publisher{hub: hub, queue: make(chan queuedLog, publishQueueSize)}
	if common.RedisEnabled && common.RDB != nil {
		p.bridge = newBridge(common.RDB, hub, bridgeMaintainEvery, bridgeOnlineTTL)
		go p.bridge.run(ctx)
	}
	go p.run(ctx)
	activeHub.Store(hub)
	model.SetLogCreatedHook(p.observe)
}

// ActiveHub returns the hub Start created, or nil when streams are off.
func ActiveHub() *Hub {
	return activeHub.Load()
}

// Stop ends every live stream, so clients reconnect to another node, and
// removes the log hook. Call it before the HTTP server shuts down.
func Stop() {
	model.SetLogCreatedHook(nil)
	if hub := activeHub.Load(); hub != nil {
		hub.Close()
	}
}
