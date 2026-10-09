package broadway

import (
	"context"
	"encoding/json"
	"strconv"
	"sync"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/flight"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/model"
)

// scrapeUpcoming reads the upcoming list.
func (s *Scraper) scrapeUpcoming(ctx context.Context, html string, concurrency int) []model.Movie {
	doc := flight.Extract(html)
	records := flight.Records(doc)

	// The upcoming list lives under its own key. Reading "movies" here found
	// nothing and silently produced zero rows — the whole 待上映 half of the
	// circuit, 132 films as of 2026-10-09.
	raw := flight.SliceArray(doc, "upcomingList")
	if raw == "" {
		return nil
	}
	var list []map[string]any
	if err := json.Unmarshal([]byte(raw), &list); err != nil {
		return nil
	}

	out := make([]model.Movie, 0, len(list))
	for _, m := range list {
		id := intFromAny(m["id"])
		if id <= 0 {
			continue
		}
		nameLang := flight.LangField(records, m["name_lang"])
		descLang := flight.LangField(records, m["description_lang"])

		movie := model.Movie{
			ID:          Source + "-" + strconv.Itoa(id),
			Slug:        slugify(nameLang["zh_hk"], correctedEnglish(nameLang["en"]), id),
			NameZh:      nameLang["zh_hk"],
			NameEn:      correctedEnglish(nameLang["en"]),
			OpeningDate: nullableString(hktDate(stringOr(m, "openingDate"))),
			Duration:    nullishInt(m, "duration"),
			Category:    nullish(m, "category"),
			Dialect:     nullish(m, "dialect"),
			Subtitle:    nullish(m, "subtitle"),
			Genres:      genresOf(records, m),
			Director:    nullableString(firstNonEmpty(pickLang(records, m, "director_lang"), stringOr(m, "director"))),
			Cast:        nullableString(firstNonEmpty(pickLang(records, m, "cast_lang"), stringOr(m, "cast"))),
			// Chinese first: the top-level description is the English original, and
			// this is a Traditional Chinese site, so using it would BE the bug.
			Description: stripHTML(firstNonEmpty(descLang["zh_hk"], descLang["en"], stringOr(m, "description"))),
			Poster:      posterOf(m),
			// `|| null`, not `?? null`: an empty trailer becomes null.
			Trailer:   nullableString(stringOr(m, "trailer")),
			DetailURL: Base + "/hk/movie/" + strconv.Itoa(id),
			Status:    "upcoming",
			Source:    model.SourceBroadway,
		}
		out = append(out, movie)
	}

	return backfillDescriptions(ctx, s, out, concurrency)
}

// backfillDescriptions fills in Chinese synopses from the detail pages.
//
// The list omits the Chinese synopsis for many films — stage plays, opera
// screenings and KINO features store only an English summary — so those films
// would render their synopsis in English. Only the films missing Chinese are
// fetched, so the extra cost is normally near zero.
func backfillDescriptions(ctx context.Context, s *Scraper, list []model.Movie, concurrency int) []model.Movie {
	type pending struct {
		idx  int
		id   int
		text string
	}
	var todo []pending
	for i, m := range list {
		if hasCJK(m.Description) {
			continue
		}
		todo = append(todo, pending{idx: i, id: atoiSuffix(m.ID)})
	}
	if len(todo) == 0 {
		return list
	}

	patched := make([]string, len(todo))
	var mu sync.Mutex
	runPool(len(todo), concurrency, func(i int) {
		body, err := s.Client.Get(ctx, Base+"/hk/movie/"+strconv.Itoa(todo[i].id))
		if err != nil {
			return
		}
		doc := flight.Extract(string(body))
		records := flight.Records(doc)
		movie := detailMovie(doc, todo[i].id)
		if movie == nil {
			return
		}
		desc := flight.LangField(records, movie["description_lang"])
		text := stripHTML(firstNonEmpty(desc["zh_hk"], desc["en"], stringOr(movie, "description")))
		if !hasCJK(text) {
			return
		}
		mu.Lock()
		patched[i] = text
		mu.Unlock()
	})

	for i, p := range todo {
		if patched[i] != "" {
			list[p.idx].Description = patched[i]
		}
	}
	return list
}
