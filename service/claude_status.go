package service

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const (
	claudeStatusURL       = "https://status.claude.com/api/v2/summary.json"
	claudeAPIComponentID  = "k8w3r06qmzrp" // Claude API (api.anthropic.com) on Anthropic's status page.
	claudeStatusBodyLimit = 1 << 20
)

type ClaudeStatusIncident struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

type ClaudeAPIStatus struct {
	Status              string                 `json:"status"`
	Incidents           []ClaudeStatusIncident `json:"incidents"`
	CheckedAt           int64                  `json:"checked_at"`
	Stale               bool                   `json:"stale"`
	RefreshAfterSeconds int                    `json:"refresh_after_seconds"`
}

type claudeStatusCache struct {
	mu          sync.Mutex
	client      *http.Client
	snapshot    ClaudeAPIStatus
	nextRefresh time.Time
	err         error // Retained during the retry interval if no snapshot exists yet.
}

var officialClaudeStatus = claudeStatusCache{client: &http.Client{Timeout: 5 * time.Second}}

func GetClaudeAPIStatus() (ClaudeAPIStatus, error) {
	return officialClaudeStatus.get()
}

func (cache *claudeStatusCache) get() (ClaudeAPIStatus, error) {
	// A single cache entry and a bounded HTTP request let all concurrent visitors
	// share the same refresh, including its failure cooldown.
	cache.mu.Lock()
	defer cache.mu.Unlock()
	now := time.Now()
	if !now.Before(cache.nextRefresh) {
		fresh, err := fetchClaudeAPIStatus(cache.client)
		now = time.Now()
		if err == nil {
			fresh.CheckedAt = now.Unix()
			cache.snapshot, cache.err = fresh, nil
			cache.nextRefresh = now.Add(5 * time.Minute)
		} else {
			cache.nextRefresh = now.Add(time.Minute)
			if cache.snapshot.Status == "" {
				cache.err = err
			} else {
				cache.snapshot.Stale = true
			}
		}
	}

	status := cache.snapshot
	status.RefreshAfterSeconds = int((cache.nextRefresh.Sub(now) + time.Second - 1) / time.Second)
	return status, cache.err
}

type claudeStatusComponent struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

type claudeIncident struct {
	ClaudeStatusIncident
	Components []claudeStatusComponent `json:"components"`
	Updates    []struct {
		Affected []struct {
			Code string `json:"code"`
		} `json:"affected_components"`
	} `json:"incident_updates"`
}

func (incident claudeIncident) affectsAPI() bool {
	if len(incident.Components) > 0 {
		return slices.ContainsFunc(incident.Components, func(c claudeStatusComponent) bool { return c.ID == claudeAPIComponentID })
	}
	for _, update := range incident.Updates {
		for _, component := range update.Affected {
			if component.Code == claudeAPIComponentID {
				return true
			}
		}
	}
	return false
}

func fetchClaudeAPIStatus(client *http.Client) (ClaudeAPIStatus, error) {
	resp, err := client.Get(claudeStatusURL)
	if err != nil {
		return ClaudeAPIStatus{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ClaudeAPIStatus{}, fmt.Errorf("Claude status returned HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, claudeStatusBodyLimit+1))
	if err != nil {
		return ClaudeAPIStatus{}, err
	}
	if len(body) > claudeStatusBodyLimit {
		return ClaudeAPIStatus{}, errors.New("Claude status response is too large")
	}
	var summary struct {
		Components []claudeStatusComponent `json:"components"`
		Incidents  []claudeIncident        `json:"incidents"`
	}
	if err := common.Unmarshal(body, &summary); err != nil {
		return ClaudeAPIStatus{}, err
	}
	index := slices.IndexFunc(summary.Components, func(c claudeStatusComponent) bool { return c.ID == claudeAPIComponentID })
	if index < 0 || summary.Components[index].Status == "" {
		return ClaudeAPIStatus{}, errors.New("Claude API component status is missing")
	}
	result := ClaudeAPIStatus{Status: summary.Components[index].Status, Incidents: []ClaudeStatusIncident{}}
	for _, incident := range summary.Incidents {
		if incident.Name != "" && incident.Status != "" && incident.Status != "resolved" && incident.Status != "postmortem" && incident.affectsAPI() {
			result.Incidents = append(result.Incidents, incident.ClaudeStatusIncident)
		}
	}
	return result, nil
}
