package contentsafety

import (
	"errors"
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
	// MaxQueuedReviewsPerAccount bounds the background reviews of one account
	// waiting or running on a node, so one account cannot fill the queue.
	MaxQueuedReviewsPerAccount = 20
)

var (
	// ErrQueueFull means the background review queue has no room.
	ErrQueueFull = errors.New("content review queue is full")
	// ErrAccountQueueFull means the account already has
	// MaxQueuedReviewsPerAccount background reviews on this node.
	ErrAccountQueueFull = errors.New("content review queue holds too many reviews of the account")
)

// reviewQueue holds background reviews for a fixed set of workers, bounded by
// a job count, the bytes of the queued text and the jobs of each account. Its
// size and worker count are read when the first review is queued, so
// changing them takes a restart. Pending reviews are lost when the process
// stops.
type reviewQueue struct {
	start   sync.Once
	jobs    chan reviewJob
	bytes   atomic.Int64
	dropped atomic.Int64
	// warned is when the last drop warning was written, in Unix nanoseconds.
	warned atomic.Int64

	accountMu sync.Mutex
	// accounts counts the jobs of each account waiting or running.
	accounts map[int]int
}

type reviewJob struct {
	run    func()
	size   int64
	userId int
}

var reviews = reviewQueue{accounts: map[int]int{}}

// EnqueueReview queues run, which reviews size bytes of text for userId,
// without waiting. It returns ErrAccountQueueFull when the account has too
// many reviews queued and ErrQueueFull when the queue has no room; the
// caller records either and forces the account's next requests to a
// synchronous review.
func EnqueueReview(userId int, size int64, run func()) error {
	reviews.start.Do(func() {
		cfg := operation_setting.GetContentSafetySetting().Bounded()
		reviews.jobs = make(chan reviewJob, cfg.AsyncQueueSize)
		for range cfg.AsyncWorkers {
			go reviews.work()
		}
	})
	reviews.accountMu.Lock()
	if reviews.accounts[userId] >= MaxQueuedReviewsPerAccount {
		reviews.accountMu.Unlock()
		return ErrAccountQueueFull
	}
	reviews.accounts[userId]++
	reviews.accountMu.Unlock()
	if reviews.bytes.Add(size) > maxQueuedReviewBytes {
		reviews.bytes.Add(-size)
		reviews.finish(userId)
		reviews.drop()
		return ErrQueueFull
	}
	select {
	case reviews.jobs <- reviewJob{run: run, size: size, userId: userId}:
		return nil
	default:
		reviews.bytes.Add(-size)
		reviews.finish(userId)
		reviews.drop()
		return ErrQueueFull
	}
}

// finish takes one job of userId off the account's count.
func (q *reviewQueue) finish(userId int) {
	q.accountMu.Lock()
	defer q.accountMu.Unlock()
	q.accounts[userId]--
	if q.accounts[userId] <= 0 {
		delete(q.accounts, userId)
	}
}

func (q *reviewQueue) work() {
	for job := range q.jobs {
		q.runJob(job)
	}
}

// runJob runs one review; a panic is logged so the worker keeps serving.
func (q *reviewQueue) runJob(job reviewJob) {
	defer q.finish(job.userId)
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
