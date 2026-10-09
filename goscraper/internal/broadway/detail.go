package broadway

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/flight"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/model"
)

// detailMovie extracts the film object from a detail page document.
//
// The record is located by its id plus the field that always follows it, so a
// nested object carrying the same id cannot be mistaken for it.
func detailMovie(doc string, id int) map[string]any {
	marker := `{"id":` + strconv.Itoa(id) + `,"openingDate"`
	i := strings.Index(doc, marker)
	if i < 0 {
		return nil
	}
	end := matchBrace(doc, i)
	if end < 0 {
		return nil
	}
	var movie map[string]any
	if err := json.Unmarshal([]byte(doc[i:end]), &movie); err != nil {
		return nil
	}
	return movie
}

// scrapeMovieDetail fetches one film's page and builds its record.
func (s *Scraper) scrapeMovieDetail(ctx context.Context, id int, ticketingRecords map[int]string, listed map[string]any) (*model.Movie, error) {
	body, err := s.Client.Get(ctx, Base+"/hk/movie/"+strconv.Itoa(id))
	if err != nil {
		return nil, err
	}
	doc := flight.Extract(string(body))
	movie := detailMovie(doc, id)
	if movie == nil {
		return nil, nil
	}
	records := flight.Records(doc)
	nameLang := flight.LangField(records, movie["name_lang"])
	descLang := flight.LangField(records, movie["description_lang"])

	return &model.Movie{
		ID:          Source + "-" + strconv.Itoa(id),
		Slug:        slugify(nameLang["zh_hk"], correctedEnglish(nameLang["en"]), id),
		NameZh:      nameLang["zh_hk"],
		NameEn:      correctedEnglish(nameLang["en"]),
		OpeningDate: scrapeutilNullable(hktDate(stringOr(movie, "openingDate"))),
		Duration:    nullishInt(movie, "duration"),
		Category:    nullish(movie, "category"),
		Dialect:     nullish(movie, "dialect"),
		Subtitle:    nullish(movie, "subtitle"),
		Genres:      genresOf(records, movie),
		Director:    scrapeutilNullable(firstNonEmpty(pickLang(records, movie, "director_lang"), stringOr(movie, "director"))),
		Cast:        scrapeutilNullable(firstNonEmpty(pickLang(records, movie, "cast_lang"), stringOr(movie, "cast"))),
		Description: stripHTML(firstNonEmpty(descLang["zh_hk"], descLang["en"], stringOr(movie, "description"))),
		Poster:      posterOf(movie),
		Trailer:     nullableString(stringOr(movie, "trailer")),
		DetailURL:   Base + "/hk/movie/" + strconv.Itoa(id),
		Status:      "showing",
		Source:      model.SourceBroadway,
	}, nil
}

// minimalMovie builds a record from listing data alone.
//
// Used when the detail request failed. The result is thinner but complete
// enough to render, which matters because a missing film would otherwise
// leave its screenings orphaned.
func minimalMovie(records map[int]string, m map[string]any, id int) model.Movie {
	lang := flight.LangField(records, nilOr(m, "name_lang"))
	desc := flight.LangField(records, nilOr(m, "description_lang"))
	nameEn := correctedEnglish(firstNonEmpty(lang["en"], stringOr(m, "name")))
	return model.Movie{
		ID:          Source + "-" + strconv.Itoa(id),
		Slug:        slugify(lang["zh_hk"], nameEn, id),
		NameZh:      lang["zh_hk"],
		NameEn:      nameEn,
		OpeningDate: nullableString(hktDate(stringOr(m, "openingDate"))),
		Duration:    nullishInt(m, "duration"),
		// The listing publishes an empty dialect/subtitle on about a quarter of
		// its films; `?? null` keeps those as "" rather than null.
		Category:    nullish(m, "category"),
		Dialect:     nullish(m, "dialect"),
		Subtitle:    nullish(m, "subtitle"),
		Genres:      genresOf(records, m),
		Director:    scrapeutilNullable(firstNonEmpty(pickLang(records, m, "director_lang"), stringOr(m, "director"))),
		Cast:        scrapeutilNullable(firstNonEmpty(pickLang(records, m, "cast_lang"), stringOr(m, "cast"))),
		Description: stripHTML(firstNonEmpty(desc["zh_hk"], desc["en"], stringOr(m, "description"))),
		Poster:      posterOf(m),
		Trailer:     scrapeutilNullable(stringOr(m, "trailer")),
		DetailURL:   Base + "/hk/movie/" + strconv.Itoa(id),
		Status:      "showing",
		Source:      model.SourceBroadway,
	}
}
