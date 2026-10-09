// Package imdb ports the IMDb side of the ratings layer: title to tt id, and
// tt id to a rating.
//
// Ported from scrapers/imdb.js. Two endpoints, neither needing a key and
// neither rate-limiting in practice:
//
//  1. title -> tt id: the official suggestion endpoint at v3.sg.media-imdb.com
//  2. tt id -> rating: agregarr's ratings mirror of IMDb's public score
//
// IMDb's own title pages answer 202 to a scraper and its public GraphQL answers
// 403 with terms that forbid exactly this use, so neither is touched here.
//
// The judgement in this file is which candidate is the same film, and that is
// mostly the year gate: see IMDbDoubanYearMaxGap for why a title match on its own
// is not enough.
package imdb

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"sort"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/fetch"
)

// suggestRoot is IMDb's official suggestion endpoint.
const suggestRoot = "https://v3.sg.media-imdb.com/suggestion/x"

// ratingsRoot serves IMDb's public score. The path takes the tt id as a query
// parameter rather than as part of the URL.
const ratingsRoot = "https://api.agregarr.org/api/ratings"

// reissueMaxYears is how far back a reissue is allowed to reach when the title
// match was weak, which is all a substring comparison earns.
const reissueMaxYears = 12

// reissueMaxYearsStrong is the same window for a confident title match. Classic
// restorations reach further than 20 years: Neon Genesis Evangelion 1997 has its
// Hong Kong release in 2026, 29 years later.
const reissueMaxYearsStrong = 45

// strongTitle is the score at which a title is considered trustworthy enough to
// use the wider reissue window.
const strongTitle = 76

// ReissueMinDoubanGap is the year difference that counts as positive evidence
// that a film is an older title being re-released.
//
// Douban stores the ORIGINAL premiere year, so a reissue sits years below the
// Hong Kong year, while a genuinely new film with the same name sits alongside
// it. Five years leaves room for a December shoot premiering in January and
// nothing more.
const ReissueMinDoubanGap = 5

// ReissueYearTolerance is how far a fallback candidate's year may sit from
// Douban's original year.
//
// Measured across the full 211-film set, a correct match is always exact; the
// smallest gap found on a wrong match is 4 (A Taxi Driver: Douban 2013's
// 辩护人 vs IMDb 2017). One year of slack covers a festival premiere being
// listed against its release year, and stays far away from the mismatches.
// A missing score is worse than showing nothing, and a wrong score is not.
const ReissueYearTolerance = 1

// IMDbDoubanYearMaxGap is the year gate for the PREFERRED candidate.
//
// Why this gate has to exist, and why it lives only here:
//
//	ReissueYearTolerance only guards the reissue fallback, so it never sees the
//	preferred candidate. An audit on 2026-10-09 of the 190 records that carry
//	years on both sides found 14 films showing the wrong title's score:
//	  跟蹤      HK 2026 -> IMDb "Following" 2024 (a different film) / Douban 2007
//	  玩謝麥高維治 -> IMDb "Being Related to John Malkovich" 2025 / Douban 1999
//	  危險人物  -> IMDb "Stealing Pulp Fiction" 2024 / Douban 1999
//	  街霸      -> IMDb "Street Fighter" 1994 (the animation) / Douban 2026
//	The shared shape: the title substring looked close enough to enter the
//	candidate list, and nobody checked WHICH YEAR's film it was.
//
// Why 3 and not the 10 the first draft used: a test caught it. Setting 10 was
// derived from "every record with a gap above 10 was a mismatch, none below was
// wrong", and the very next test run failed on 覲見英女皇, whose IMDb entry
// "The Audience" 2020 sits 7 years from Douban 2013 and is a mismatch: that
// 2020 entry is a TV-series film, and the right answer is tt3154822 (NT Live
// 2015, 8.5). Re-checking each gap from 1 to 10 by hand:
//
//	gaps of 0-2 years: 168 records, all correct
//	gaps of 4 and above: confirmed mismatches at 4, 6, 7 and 9
//
// The gap-3 band is empty in the data, so 3 sits against the right edge of the
// correct range and the left edge of the mismatch range.
//
// Why stage captures are let through separately (see IsStageCaptureTitle): NT
// Live and the ballet companies film one performance, so the IMDb entry records
// the RECORDING year while Douban records the work's own year. Those are years
// apart by nature and genuinely the same piece:
//
//	恨世者   IMDb 2026 / Douban 2017 (gap 9)
//	不可兒戲 IMDb 2025 / Douban 2015 (gap 10)
//	孽戀焚情 IMDb 2026 / Douban 1988 (gap 38)
//
// A 3-year gate would kill all three.
//
// The exemption only trusts a capture marker IN THE IMDB TITLE, never "NT Live"
// in the venue's own name. 覲見英女皇 is listed under "NT Live" too, but its
// IMDb entry is a bare "The Audience" with no marker, so it is still blocked.
// What separates them is not the venue name: it is whether the IMDb entry
// itself is a capture.
//
// Rejecting is always better than showing the wrong score: a missing score
// renders as 暫無評分 and costs one field, while a wrong score is read as fact.
//
// Why the gate has no direction: Douban holds the original premiere year, and
// the Hong Kong year can be later (a classic reissue) or earlier (a Japanese
// film arriving first). Both directions have correct cases (haiwaan is Douban
// 2027 / HK 2026), so this is a cap and not a sign test.
const IMDbDoubanYearMaxGap = 3

// stageCaptureRe marks a title as a filmed stage or dance performance: an image
// of one performance rather than another work.
var stageCaptureRe = regexp.MustCompile(`(?i)national theatre live|royal ballet|opera ballet|bolshoi ballet|\bnt live\b`)

// IsStageCaptureTitle reports whether an IMDb title is a stage capture.
func IsStageCaptureTitle(title string) bool {
	return stageCaptureRe.MatchString(title)
}

// IsReissueEvidence reports positive evidence that this is an older film being
// re-released.
//
// The fallback this guards has an intent: a reissue often has TWO IMDb entries,
// the 1997 original with a score and a fresh 2025 entry opened for the reissue
// with none, and showing "暫無評分" for that is wrong.
//
// But "the preferred entry has no score" has two causes that look identical in
// the candidate list:
//
//	a) a real reissue: the preferred entry is the new one, the original has a
//	   score, so falling back is right;
//	b) a genuinely new film with an old namesake: the preferred entry is brand
//	   new and unrated, an unrelated older film has a score, so falling back
//	   would put the wrong number on screen. Seven of eleven real fallbacks were
//	   this: Resident Evil (2026) picked up the 2002 film's 6.6.
//
// Douban's year is the only outside information that separates them, so with no
// Douban data there is no fallback at all. Missing a score is recoverable;
// attaching another film's is not.
func IsReissueEvidence(doubanYear, hkYear int) bool {
	if doubanYear == 0 || hkYear == 0 {
		return false
	}
	return hkYear-doubanYear >= ReissueMinDoubanGap
}

// MatchesDoubanYear is the second gate: does a fallback candidate's year agree
// with Douban's original year?
//
// The first gate only proves "this is an old film", not "this IMDb entry IS it".
// Counter-examples measured on real data:
//
//	恨世者  Douban 2017 / fallback tt0807755:2001 "The Misanthrope" -> gap 16,
//	  a different adaptation
//	天鵝湖  Douban 1998 / fallback tt32986839:2024 "Swan Lake" -> gap 26, a
//	  different recording
//
// Correct cases sit at gap 0:
//
//	EVA 死與新生  Douban 1997 / tt0169880:1997
//	追擊8月15   Douban 2004 / tt0441565:2004
//
// A candidate with no year is not rejected: some IMDb entries carry none, and
// that should not cost a real reissue.
func MatchesDoubanYear(candYear, doubanYear int) bool {
	if doubanYear == 0 {
		return false
	}
	if candYear == 0 {
		return true
	}
	return abs(candYear-doubanYear) <= ReissueYearTolerance
}

// YearGateOptions carries the extra facts the gate needs beyond the two years.
type YearGateOptions struct {
	// VenueName is the venue's own listing name. It only matters for the
	// venue-capture case below.
	VenueName string
	// HKYear is the Hong Kong release year.
	HKYear int
}

// YearGateOk is the gate on the preferred candidate: reject when its year is
// too far from Douban's.
//
// It only applies when BOTH years are known. With no Douban match there is no
// second axis, and refusing to reject would be inventing one: a candidate that
// already passed the title score should stand.
//
// hasRating matters as much as the years. An unrated entry is most likely one
// opened for THIS reissue, whose year naturally sits far from Douban's original,
// and rejecting it would also reject the only correct entry (the fallback path
// depends on it ranking first). Passing false hands the decision to the
// reissue-evidence rule instead.
func YearGateOk(imdbYear, doubanYear int, hasRating bool, imdbTitle string, opt YearGateOptions) bool {
	if doubanYear == 0 || imdbYear == 0 {
		return true
	}
	if !hasRating {
		return true
	}
	gap := abs(imdbYear - doubanYear)
	if gap <= IMDbDoubanYearMaxGap {
		return true
	}
	if gap <= reissueMaxYearsStrong && IsStageCaptureTitle(imdbTitle) {
		return true
	}
	// A new recording of an old play: the IMDb year is this season's recording
	// and therefore the Hong Kong year, while Douban holds the premiere year.
	// IMDb does not mark these consistently, so the recognition cannot come from
	// the title: 恨世者's entry says "National Theatre Live" while 吾子吾弟's is a
	// bare "All My Sons" (2026). It is recognised instead by the candidate year
	// sitting on the Hong Kong year, because a new recording is necessarily made
	// in the year it is released.
	//
	// This is also what keeps 覲見英女皇 out: its venue name says NT Live too,
	// but the mismatched "The Audience" is from 2020, six years before the 2026
	// Hong Kong run.
	if IsStageCaptureTitle(opt.VenueName) && opt.HKYear != 0 {
		return abs(imdbYear-opt.HKYear) <= 1
	}
	return false
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// client talks to both endpoints.
type client struct {
	hc *fetch.Client
}

// newClient builds a client with the IMDb browser agent the endpoints expect.
func newClient() *client {
	return &client{hc: fetch.New(fetch.WithUserAgent(fetch.DefaultUserAgent), fetch.WithRetries(1))}
}

// Candidate is one title IMDb suggested.
type Candidate struct {
	ID    string
	Title string
	Year  int
	QID   string
}

// ttIDRe keeps only real title entries: the suggestion endpoint also returns
// people, companies and episodes, which share the response shape.
var ttIDRe = regexp.MustCompile(`^tt\d+$`)

// Suggest returns the candidates for one title.
//
// A nil result with a nil error means the request FAILED, which is not the same
// as an empty result. The caller needs the difference: an empty result is a real
// answer and gets cached as not-found, while a failure must not be cached or the
// 7-day retry window would be spent on a network blip.
func (c *client) Suggest(ctx context.Context, title string) ([]Candidate, error) {
	url := suggestRoot + "/" + url.PathEscape(title) + ".json?includeVideos=0"
	body, err := c.hc.GetWithHeaders(ctx, url, map[string]string{"Accept": "application/json"})
	if err != nil {
		return nil, err
	}
	var payload struct {
		D []struct {
			ID  string `json:"id"`
			L   string `json:"l"`
			Y   int    `json:"y"`
			QID string `json:"qid"`
		} `json:"d"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	var out []Candidate
	for _, row := range payload.D {
		if row.ID == "" || !ttIDRe.MatchString(row.ID) {
			continue
		}
		out = append(out, Candidate{ID: row.ID, Title: row.L, Year: row.Y, QID: row.QID})
	}
	return out, nil
}

// Rating is one IMDb score.
type Rating struct {
	Rating float64
	Votes  int
}

// Ratings fetches the score for a tt id.
//
// nil means no usable answer, either because the request failed or because the
// entry exists but has too few votes to have a score yet. Those two cases have
// the same consequence for the caller (leave the score null) but not the same
// consequence for the retry logic, so the distinction lives in the error.
func (c *client) Ratings(ctx context.Context, imdbID string) (*Rating, error) {
	url := ratingsRoot + "?id=" + url.QueryEscape(imdbID)
	body, err := c.hc.GetWithHeaders(ctx, url, map[string]string{"Accept": "application/json"})
	if err != nil {
		return nil, err
	}
	var row struct {
		Rating *float64 `json:"rating"`
		Votes  *int     `json:"votes"`
	}
	// The endpoint answers with either a one-element array or a bare object,
	// depending on the mirror's mood.
	if err := jsonUnmarshalFirst(body, &row); err != nil {
		return nil, err
	}
	if row.Rating == nil {
		return nil, nil
	}
	rating := Rating{Rating: *row.Rating}
	if row.Votes != nil {
		rating.Votes = *row.Votes
	}
	return &rating, nil
}

// Scored is a ranked candidate.
type Scored struct {
	Candidate Candidate
	Score     int
}

// RankOptions loosens the year window for reissues, festival runs and live
// theatre.
type RankOptions struct {
	Reissue bool
}

// Rank scores and orders the candidates that clear the bar.
//
// The order is: title confidence first, then the EARLIER year wins. Ties on
// score go to the original release, which is what stops a reissue's fresh
// unrated entry from being the one shown.
func Rank(candidates []Candidate, query string, year int, opt RankOptions) []Scored {
	var out []Scored
	for _, candidate := range candidates {
		if one, ok := scoreCandidate(candidate, query, year, opt); ok {
			out = append(out, one)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return candidateYear(out[i]) < candidateYear(out[j])
	})
	return out
}

// candidateYear reads a year, treating zero as "unknown" so it sorts last
// rather than first.
func candidateYear(s Scored) int {
	if s.Candidate.Year == 0 {
		return 9999
	}
	return s.Candidate.Year
}

// scoreCandidate scores one candidate, reporting false when it does not
// qualify.
func scoreCandidate(candidate Candidate, query string, year int, opt RankOptions) (Scored, bool) {
	q := Norm(query)
	if q == "" || candidate.ID == "" {
		return Scored{}, false
	}
	// Only films. The suggestion endpoint mixes in people and companies, and a
	// name match against those is meaningless.
	if candidate.QID != "" && candidate.QID != "movie" {
		return Scored{}, false
	}
	n := Norm(candidate.Title)
	if n == "" {
		return Scored{}, false
	}
	base := TitleScore(n, q)
	if base == 0 {
		return Scored{}, false
	}
	score := base

	switch {
	case year != 0 && candidate.Year != 0:
		d := candidate.Year - year
		switch {
		case d == 0:
			score += 20
		case abs(d) <= 3:
			if d < 0 {
				// The original release, when the two are close.
				score += 12
			} else {
				score += 6
			}
		case d < 0 && opt.Reissue:
			// Reissue window, tiered by title confidence. A flat 12 years would
			// kill classic restorations (EVA 1997 -> HK 2026, 29 years); no cap at
			// all would match "M (GFF) 2026" to Lang's M from 1931.
			cap := reissueMaxYears
			if base >= strongTitle {
				cap = reissueMaxYearsStrong
			}
			if -d > cap {
				return Scored{}, false
			}
			score += 4
		default:
			return Scored{}, false
		}
	case year != 0 && candidate.Year == 0:
		// No year to check against, so the entry cannot be verified. Kept, but
		// ranked below anything that can be.
		score -= 10
	}
	return Scored{Candidate: candidate, Score: score}, true
}

// TrimmedCandidate renders a candidate the way the cache file records it, as
// "id:year:score".
func TrimmedCandidate(s Scored) string {
	year := "?"
	if s.Candidate.Year != 0 {
		year = fmt.Sprintf("%d", s.Candidate.Year)
	}
	return fmt.Sprintf("%s:%s:%d", s.Candidate.ID, year, s.Score)
}

// URL builds the IMDb page link for an entry, matching imdbUrl().
func URL(id string) *string {
	if id == "" {
		return nil
	}
	link := "https://www.imdb.com/title/" + id + "/"
	return &link
}

// jsonUnmarshalFirst decodes a body that is either a one-element array or a
// bare object.
//
// The ratings mirror answers with whichever of the two it likes, so the shape is
// resolved by peeking at the first non-space byte rather than by trying both
// and hoping: a malformed body has to be an error, not something that silently
// decodes as an empty array.
func jsonUnmarshalFirst(body []byte, target any) error {
	trimmed := bytes.TrimLeft(body, " \t\r\n")
	if len(trimmed) == 0 {
		return fmt.Errorf("empty JSON body")
	}
	if trimmed[0] == '[' {
		var rows []json.RawMessage
		if err := json.Unmarshal(trimmed, &rows); err != nil {
			return err
		}
		if len(rows) == 0 {
			return nil
		}
		return json.Unmarshal(rows[0], target)
	}
	return json.Unmarshal(trimmed, target)
}
