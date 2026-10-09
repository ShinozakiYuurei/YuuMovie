package enrich

import (
	"context"
	"regexp"
	"strings"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/douban"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/imdb"
)

// fetchIMDb resolves a film to an IMDb entry and reads its score.
//
// Three query forms are prepared per name. Brackets usually hold the venue's own
// notes ((GFF), (IMAX), (The Royal Ballet 2026-2027)) and IMDb cannot search them,
// so a bracket-free form is prepared as well. Broadway also writes 4DX, CGS and
// Infinity Vision straight into the title, so a brand-stripped form is prepared too;
// the 2026 reissue of 復仇者聯盟4 measured the case where the bare name was needed.
func (r *Runner) fetchIMDb(ctx context.Context, item *planItem, doubanYear int) (*IMDb, error) {
	queries := expandQueries(item.Queries)
	candidates, err := r.imdb.Resolve(ctx, queries, item.Year, 0)
	if err != nil {
		return nil, err
	}
	if len(candidates) == 0 {
		return nil, nil
	}

	// The preferred candidate is scored first, then put through the year gate.
	//
	// The gate ORDER is deliberate: the score has to be known BEFORE the entry can
	// be vetoed, because imdb.YearGateOk only bites on an entry that has a score.
	// An unrated entry is most likely one opened for this reissue, whose year
	// naturally sits far from Douban's, and vetoing it would also veto the only
	// correct entry (the fallback depends on it ranking first). Not fetching the
	// score up front makes the two cases indistinguishable, so the extra request is
	// the cost.
	//
	// Cost is bounded: once an entry is scored and passes, no later candidate is
	// read, or 212 films at up to 5 candidates each would hammer the ratings
	// endpoint.
	first := candidates[0]
	firstRating, err := r.imdb.Ratings(ctx, first.Candidate.ID)
	r.pause(ratingPauseMin, ratingPauseMax)
	if err != nil {
		return nil, err
	}
	firstHasRating := firstRating != nil && firstRating.Rating != 0
	firstVetoed := firstHasRating && !imdb.YearGateOk(first.Candidate.Year, doubanYear, true,
		first.Candidate.Title, imdb.YearGateOptions{VenueName: venueName(item), HKYear: item.Year})
	if firstHasRating && !firstVetoed {
		return shapeIMDb(first, firstRating, candidates, nil), nil
	}

	// The preferred entry has no score. Falling back to an older original needs
	// POSITIVE evidence that this is a reissue, or the page shows 暫無評分. No
	// evidence means the preferred entry is kept rather than risking another film's
	// score: seven of eleven real fallbacks were exactly that mistake. The evidence
	// is Douban's year, which is why the caller must run Douban first.
	//
	// When the preferred entry was VETOED, the search continues regardless of the
	// evidence: the veto says the top entry is the wrong film and the lack of
	// evidence only says it has no score. Both cases have to look further, or
	// vetoing the first entry would end the search and score the film as nothing.
	allow := firstVetoed || imdb.IsReissueEvidence(doubanYear, item.Year)
	if allow {
		for _, candidate := range candidates[1:] {
			// The second gate: this candidate's year has to agree with Douban's
			// original year, or it is just another old film of the same name
			// (measured on 恨世者 and 天鵝湖).
			if !imdb.MatchesDoubanYear(candidate.Candidate.Year, doubanYear) {
				continue
			}
			rating, err := r.imdb.Ratings(ctx, candidate.Candidate.ID)
			r.pause(ratingPauseMin, ratingPauseMax)
			if err != nil {
				return nil, err
			}
			if rating != nil && rating.Rating != 0 {
				return shapeIMDb(candidate, rating, candidates, nil), nil
			}
		}
	}
	return shapeIMDb(first, nil, candidates, &allow), nil
}

// shapeIMDb builds the record for the preferred and fallback cases alike.
func shapeIMDb(pick imdb.Resolved, rating *imdb.Rating, candidates []imdb.Resolved, reissueEvidence *bool) *IMDb {
	out := &IMDb{
		ID:          pick.Candidate.ID,
		URL:         imdb.URL(pick.Candidate.ID),
		Year:        pick.Candidate.Year,
		QueriedWith: pick.Query,
		RelaxedYear: pick.RelaxedYear,
	}
	if title := pick.Candidate.Title; title != "" {
		out.Title = &title
	}
	if rating != nil {
		out.Rating = &rating.Rating
		votes := rating.Votes
		out.Votes = &votes
	}
	// When the entry actually shown is not the preferred one, a reissue fallback
	// happened, and the source is recorded so it can be checked later.
	if len(candidates) > 0 && pick.Candidate.ID != candidates[0].Candidate.ID {
		out.FallbackFrom = candidates[0].Candidate.ID
	}
	for i, candidate := range candidates {
		if i >= 4 {
			break
		}
		out.Candidates = append(out.Candidates, candidate.Trimmed())
	}
	if reissueEvidence != nil {
		out.ReissueEvidence = *reissueEvidence
	}
	return out
}

// fetchIMDbByID reads a score for a known entry.
func (r *Runner) fetchImdbByID(ctx context.Context, imdbID string, previous *IMDb) (IMDb, error) {
	rating, err := r.imdb.Ratings(ctx, imdbID)
	r.pause(250, 600)
	if err != nil {
		return IMDb{}, err
	}
	out := IMDb{ID: imdbID, URL: imdb.URL(imdbID), QueriedWith: "manual"}
	if previous != nil {
		out.Title = previous.Title
		out.Year = previous.Year
		if previous.QueriedWith != "" {
			out.QueriedWith = previous.QueriedWith
		}
	}
	if rating != nil {
		value := rating.Rating
		out.Rating = &value
		votes := rating.Votes
		out.Votes = &votes
	}
	return out, nil
}

// expandQueries builds the search terms, keeping their order and dropping
// duplicates.
func expandQueries(names []string) []string {
	var out []string
	add := func(value string) {
		if value == "" || containsString(out, value) {
			return
		}
		out = append(out, value)
	}
	for _, name := range names {
		if name == "" {
			continue
		}
		add(name)
		cleaned := cleanBrackets(name)
		add(cleaned)
		add(douban.StripFormatBrands(cleaned))
	}
	return out
}

// bracketRe matches a bracketed run of any kind, which is where a venue writes
// its own notes: (GFF), (IMAX), (The Royal Ballet 2026-2027).
//
// The pattern is written as a raw string because Go rejects \] inside a
// double-quoted one.
var bracketRe = regexp.MustCompile("[（(〔[【{「『][^）)〕\\]】}」』]*[）)〕\\]】}」』]")

// spaceRunRe folds runs of whitespace.
var spaceRunRe = regexp.MustCompile("\\s+")

// cleanBrackets removes the venue's own bracketed notes from a name.
func cleanBrackets(value string) string {
	out := bracketRe.ReplaceAllString(value, " ")
	out = bracketRe.ReplaceAllString(out, " ")
	return strings.TrimSpace(spaceRunRe.ReplaceAllString(out, " "))
}
