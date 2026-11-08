package monitorstream

import (
	"context"
	"sync/atomic"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

const publishQueueSize = 4096

var activeHub atomic.Pointer[Hub]

// publisher receives every stored log row from model's hook. The hook runs on
// the request goroutine, so it only checks whether anyone streams the row's
// user and queues a copy; formatting and fan-out happen on one worker.
type publisher struct {
	hub    *Hub
	bridge *bridge
	queue  chan model.Log
}

func (p *publisher) observe(stored model.Log) {
	if stored.UserId <= 0 || !p.wanted(stored.UserId) {
		return
	}
	select {
	case p.queue <- stored:
	default:
		p.hub.SignalOverflow(stored.UserId)
	}
}

func (p *publisher) wanted(userID int) bool {
	return p.hub.HasSubscribers(userID) || (p.bridge != nil && p.bridge.streamsElsewhere(userID))
}

func (p *publisher) run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case stored := <-p.queue:
			event := NewEvent(stored)
			p.hub.Deliver(event)
			if p.bridge != nil && p.bridge.streamsElsewhere(event.UserID) {
				p.bridge.publish(ctx, event)
			}
		}
	}
}

// Start installs the log hook and, with Redis, the cross-node bridge. It does
// nothing while the monitor console is disabled. Call it once at startup after
// Redis is initialized.
func Start(ctx context.Context) {
	if !common.MonitorSSOEnabled {
		return
	}
	hub := NewHub(common.MonitorStreamMaxPerUser, common.MonitorStreamMaxPerNode)
	p := &publisher{hub: hub, queue: make(chan model.Log, publishQueueSize)}
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
