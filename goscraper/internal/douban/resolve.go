package douban

import (
	"context"
	"fmt"
	"time"
)

// Match is a resolved entry.
type Match struct {
	Card Card
	// Query is the search that found it.
	Query string
	// Alternatives are the other entries the same search returned, as
	// "title(year)", kept so a human can check the match.
	Alternatives []string
}

// MatchOptions are the tunables resolve honours.
type MatchOptions struct {
	// Delay is the pause between searches. The default is 250ms and it is not
	// reduced: robots.txt disallows this path and the load is kept low on purpose.
	Delay time.Duration
	// Limit caps how many queries are tried. Zero means maxQueries.
	Limit int
}

// defaultDelay is the pause between searches.
const defaultDelay = 250 * time.Millisecond

// Matcher resolves films to entries.
type Matcher struct {
	c *client
}

// NewMatcher builds a Matcher.
func NewMatcher() *Matcher { return &Matcher{c: newClient()} }

// SubjectByID reads one entry's score by id.
func (m *Matcher) SubjectByID(ctx context.Context, id string) (*Subject, error) {
	return m.c.SubjectByID(ctx, id)
}

// Resolve finds the entry for a film.
//
// The query order is: original Chinese name, cleaned Chinese name, original
// English name, cleaned English name, then the shrunken forms. Chinese leads and
// the untouched name comes first because that is the measured result: over a
// 60-film sample, using both the original and the cleaned name matched 49 films
// while the original alone matched 33. Douban's primary title is Chinese and the
// English name is a much weaker key.
//
// An error is returned when every query failed to answer. The caller uses that
// to warn and NOT write a not-found: writing one would cache a network problem
// for a week.
func (m *Matcher) Resolve(ctx context.Context, zh, en string, year int, opt MatchOptions) (*Match, error) {
	delay := opt.Delay
	if delay <= 0 {
		delay = defaultDelay
	}
	queries := ExpandQueries(zh, en)
	if opt.Limit > 0 && len(queries) > opt.Limit {
		queries = queries[:opt.Limit]
	}

	sawFailure := false
	for _, query := range queries {
		cards, err := m.c.Suggest(ctx, query)
		if err != nil {
			sawFailure = true
			wait(ctx, delay)
			continue
		}
		if len(cards) > 0 {
			card := PickCard(cards, year)
			if card != nil {
				// A same-source name has to pass the year gate. With both columns
				// holding the same word there is no translation ambiguity to lean
				// on, and "which year" is the only axis left:
				//   Queen Budapest, Hong Kong 2026 -> 《匈牙利狂想曲》1986 (a Queen
				//     concert)
				//   Lucky Star, Hong Kong 2026 -> 《幸运星》2007
				// When Douban cannot find the real film it fills the slot by
				// relevance, and search_suggest compares no titles at all, so this
				// year check is the only thing standing between the page and a
				// stranger's score.
				//
				// Only for same-source names: a Hong Kong reissue of a translated
				// title is decades newer naturally (月黑高飛 in 2026 is The
				// Shawshank Redemption from 1994), so PickCard's 45-year window is
				// required for those and must not be tightened here.
				cardYear := 0
				if card.Year != "" {
					cardYear, _ = strconvAtoi(card.Year)
				}
				if SameSourceTitle(zh, en) && !CrossYearOk(cardYear, cardYear, year) {
					continue
				}
				return &Match{
					Card:         *card,
					Query:        query,
					Alternatives: alternatives(cards),
				}, nil
			}
		}
		wait(ctx, delay)
	}
	if sawFailure {
		return nil, fmt.Errorf("douban suggest request failed")
	}
	return nil, nil
}

// alternatives renders the first few entries for the cache file.
func alternatives(cards []Card) []string {
	out := []string{}
	for i, card := range cards {
		if i >= 3 {
			break
		}
		year := "?"
		if card.Year != "" {
			year = card.Year
		}
		out = append(out, card.Title+"("+year+")")
	}
	return out
}

// wait pauses, or gives up if the context is cancelled first.
func wait(ctx context.Context, d time.Duration) {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
	case <-timer.C:
	}
}
