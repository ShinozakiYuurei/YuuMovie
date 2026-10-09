package imdb

import (
	"context"
	"fmt"
	"time"
)

// Resolved is one accepted candidate, with the query that found it.
type Resolved struct {
	Scored
	// Query is the search term that produced this candidate.
	Query string
	// RelaxedYear records that this came from the second pass, the one with the
	// wider reissue window.
	RelaxedYear bool
}

// Trimmed renders this candidate the way the cache file records it, as
// "id:year:score".
func (r Resolved) Trimmed() string { return TrimmedCandidate(r.Scored) }

// suggestDelay is the pause between searches. The suggestion endpoint tolerates
// more, but the second pass doubles the request count and this is the only
// politeness the original had.
const suggestDelay = 120 * time.Millisecond

// Client resolves titles and reads scores. It is exported so enrich can hold one
// and so tests can drive it against recorded responses.
type Client struct {
	c *client
}

// NewClient builds a client.
func NewClient() *Client { return &Client{c: newClient()} }

// Resolve returns the candidates for a film, best first.
//
// Why a LIST and not one id: a reissue usually has TWO IMDb entries, the 1997
// original with a score and a 2025 entry opened for the reissue with none.
// Showing "暫無評分" for that is wrong, so the caller needs to be able to fall
// back to the original when the preferred entry has no score.
//
// Two passes: the first insists the year is close, the second widens it to
// reissueMaxYears. The year here is the HONG KONG release year, and a reissue, a
// festival run or a filmed theatre production all sit far below it on IMDb.
// Neither pass loosens the TITLE, because that is what lets an unrelated old film
// in.
func (cl *Client) Resolve(ctx context.Context, queries []string, year, limit int) ([]Resolved, error) {
	if limit <= 0 {
		limit = 5
	}
	var found []Resolved
	seen := map[string]bool{}
	sawFailure := false

	for _, relaxed := range []bool{false, true} {
		for _, query := range queries {
			if query == "" {
				continue
			}
			candidates, err := cl.c.Suggest(ctx, query)
			if err != nil {
				sawFailure = true
			} else {
				for _, ranked := range Rank(candidates, query, year, RankOptions{Reissue: relaxed}) {
					if seen[ranked.Candidate.ID] {
						continue
					}
					seen[ranked.Candidate.ID] = true
					found = append(found, Resolved{Scored: ranked, Query: query, RelaxedYear: relaxed})
				}
			}
			sleep(ctx, suggestDelay)
		}
		if len(found) >= limit {
			break
		}
	}

	// Nothing at all, and at least one request failed: raise so the caller warns
	// and retries. Caching "not found" here would spend the 7-day window on a
	// network blip.
	if len(found) == 0 && sawFailure {
		return nil, fmt.Errorf("imdb suggest request failed")
	}
	if len(found) > limit {
		found = found[:limit]
	}
	return found, nil
}

// Ratings fetches one score.
func (cl *Client) Ratings(ctx context.Context, imdbID string) (*Rating, error) {
	return cl.c.Ratings(ctx, imdbID)
}

// sleep waits, or gives up if the context is cancelled first.
func sleep(ctx context.Context, d time.Duration) {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
	case <-timer.C:
	}
}

// Sleep exposes the pause to the enrich orchestrator, which throttles between
// films as well as between searches.
func Sleep(ctx context.Context, d time.Duration) { sleep(ctx, d) }
