package broadway

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/model"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/scrapeutil"
)

// buildShows turns the raw schedule into snapshots.
func buildShows(rawShows []map[string]any, records map[int]string, houses map[int]string) []model.Show {
	var out []model.Show
	for _, s := range rawShows {
		published, _ := s["published"].(bool)
		if !published {
			continue
		}
		movie, _ := s["movie"].(map[string]any)
		site, _ := s["site"].(map[string]any)
		house, _ := s["house"].(map[string]any)

		var showID, movieID, siteID, houseID int
		showID = intFromAny(s["id"])
		if movie != nil {
			movieID = intFromAny(movie["id"])
		}
		if site != nil {
			siteID = intFromAny(site["id"])
		}
		if house != nil {
			houseID = intFromAny(house["id"])
		}

		seats := intFromAny(s["seats"])
		available, hasAvailable := numberFromAny(s["avaliable"])

		// seats is the room's TOTAL capacity and avaliable the number still
		// bookable — confirmed by 77 rooms whose seats never change. So the
		// remaining share is available / seats, not the other way round.
		var remain model.Nullable[float64]
		if hasAvailable && seats > 0 {
			rate := available / float64(seats)
			if rate < 0 {
				rate = 0
			}
			if rate > 1 {
				rate = 1
			}
			remain = model.SomeNullable(rate)
		}

		// soldOut is only known when the circuit publishes a remaining-seat
		// count. The JS writes undefined in that case, and the key is then
		// absent from the JSON, so nil is the faithful value here.
		var soldOut *bool
		if hasAvailable {
			soldOut = model.BoolPtr(available <= 0)
		}

		var tags []string
		if list, ok := s["tags"].([]any); ok {
			for _, t := range list {
				if str, ok := t.(string); ok {
					tags = append(tags, str)
				}
			}
		}
		if tags == nil {
			tags = []string{}
		}

		price, _ := numberFromAny(s["price"])

		out = append(out, model.Show{
			ID:         Source + "-" + strconv.Itoa(showID),
			MovieID:    Source + "-" + strconv.Itoa(movieID),
			CinemaID:   Source + "-" + strconv.Itoa(siteID),
			HouseName:  houses[houseID],
			StartAt:    hktISO(stringOr(s, "time")),
			Date:       hktDate(stringOr(s, "date")),
			Price:      &price,
			Seats:      scrapeutil.NullableInt(seats),
			RemainRate: remain,
			SoldOut:    soldOut,
			Tags:       tags,
			// Broadway publishes no screening category, so the key stays
			// absent rather than null.
			Version:    model.Nullable[string]{},
			Language:   model.Nullable[string]{},
			BookingURL: Base + "/hk/show/" + strconv.Itoa(showID),
			Source:     model.SourceBroadway,
		})
	}
	return out
}

// addressRe, mapRe, codeRe, nameRe extract the cinema fields.
var (
	addressRe = regexp.MustCompile(`"address_lang":\{[^}]*?"zh_hk":"((?:[^"\\]|\\.)*)"`)
	mapURLRe  = regexp.MustCompile(`"googleMapUrl":"([^"]*)"`)
	codeRe    = regexp.MustCompile(`"code":"([^"]*)"`)
	nameRe    = regexp.MustCompile(`"name_lang":\{[^}]*?"zh_hk":"((?:[^"\\]|\\.)*)"`)
)

// buildCinemas walks the ticketing document for cinema records.
func buildCinemas(doc string) []model.Cinema {
	var out []model.Cinema
	seen := map[int]bool{}
	for _, loc := range cinemaRe.FindAllStringSubmatchIndex(doc, -1) {
		end := loc[0]
		head := strings.LastIndex(doc[:end], `{"id":`)
		if head < 0 {
			continue
		}
		idMatch := regexp.MustCompile(`^\{"id":(\d+)`).FindStringSubmatch(doc[head:])
		if idMatch == nil {
			continue
		}
		id, _ := strconv.Atoi(idMatch[1])
		if seen[id] {
			continue
		}
		seen[id] = true

		seg := doc[head : end+40]
		address := firstGroup(addressRe, seg)
		mapURL := firstGroup(mapURLRe, seg)
		code := firstGroup(codeRe, seg)
		nameZh := firstGroup(nameRe, seg)
		if nameZh == "" {
			nameZh = doc[loc[2]:loc[3]]
		}

		// The official YOHO branch address says MALL I while its Google link
		// points at MALL II, so that one link is replaced with a search built
		// from the official name and address.
		if id == 10 {
			mapURL = scrapeutil.MapSearch(nameZh, address)
		}

		out = append(out, model.Cinema{
			ID:        Source + "-" + strconv.Itoa(id),
			Code:      code,
			NameZh:    nameZh,
			Address:   address,
			MapURL:    mapURL,
			DetailURL: Base + "/hk/cinema/" + strconv.Itoa(id),
			Source:    model.SourceBroadway,
		})
	}
	return out
}
