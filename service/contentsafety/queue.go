package contentsafety

import (
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

const (
	// maxQueuedReviewBytes bounds the unit text waiting for background review.
	maxQueuedReviewBytes = 64 << 20
	queueDropWarning     = time.Minute
)

// reviewQueue holds background reviews for a fixed set of workers, bounded by
// a job count and the bytes of the queued text. Its size and worker count are
// read when the first review is queued, so changing them takes a restart.
// Pending reviews are lost when the process stops.
type reviewQueue struct {
	start   sync.Once
	jobs    chan reviewJob
	bytes   atomic.Int64
	dropped atomic.Int64
	// warned is when the last drop warning was written, in Unix nanoseconds.
	warned atomic.Int64
}

type reviewJob struct {
	run  func()
	size int64
}

var reviews reviewQueue

// EnqueueReview queues run, which reviews size bytes of text, without
// waiting. It reports false when the queue is full; the caller records the
// drop and forces the account's next requests to a synchronous review.
func EnqueueReview(size int64, run func()) bool {
	reviews.start.Do(func() {
		cfg := operation_setting.GetContentSafetySetting().Bounded()
		reviews.jobs = make(chan reviewJob, cfg.AsyncQueueSize)
		for range cfg.AsyncWorkers {
			go reviews.work()
		}
	})
	if reviews.bytes.Add(size) > maxQueuedReviewBytes {
		reviews.bytes.Add(-size)
		reviews.drop()
		return false
	}
	select {
	case reviews.jobs <- reviewJob{run: run, size: size}:
		return true
	default:
		reviews.bytes.Add(-size)
		reviews.drop()
		return false
	}
}

func (q *reviewQueue) work() {
	for job := range q.jobs {
		q.runJob(job)
	}
}

// runJob runs one review; a panic is logged so the worker keeps serving.
func (q *reviewQueue) runJob(job reviewJob) {
	defer q.bytes.Add(-job.size)
	defer func() {
		if recovered := recover(); recovered != nil {
			common.SysError(common.LogText("content safety background review panicked: %v", recovered))
		}
	}()
	job.run()
}

// drop counts a dropped review and, at most once a minute, writes a warning
// with the number dropped since the last one.
func (q *reviewQueue) drop() {
	q.dropped.Add(1)
	now, last := time.Now().UnixNano(), q.warned.Load()
	if now-last < int64(queueDropWarning) || !q.warned.CompareAndSwap(last, now) {
		return
	}
	common.SysError(common.LogText("content safety review queue is full; %d reviews were dropped", q.dropped.Swap(0)))
}
