package newport

import (
	"context"
	"regexp"
	"sync"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/model"
)

var (
	// The seat plan marks each seat with a class; total counts every seat slot
	// and available only those still bookable.
	availableRe = regexp.MustCompile(`class="[^"]*\bavailable\b`)
	totalSeatRe = regexp.MustCompile(`class="[^"]*\b(?:available|sold)\b`)
)

// fillSeatAvailability counts seats for every show, mirroring
// fillSeatAvailability() in scrapers/other-circuits.js.
//
// One extra request per show is the dominant cost of this circuit, so it runs
// with a small worker pool. A failed lookup leaves seats nil rather than
// removing the show: the JS swallows the error the same way, and a dropped show
// would look like a cancelled screening.
func (s *Scraper) fillSeatAvailability(ctx context.Context, shows []model.Show) {
	const concurrency = 4
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	for i := range shows {
		wg.Add(1)
		sem <- struct{}{}
		go func(idx int) {
			defer wg.Done()
			defer func() { <-sem }()
			body, err := s.Client.Get(ctx, shows[idx].BookingURL)
			if err != nil {
				return
			}
			page := string(body)
			total := len(totalSeatRe.FindAllString(page, -1))
			available := len(availableRe.FindAllString(page, -1))
			if total <= 0 {
				return
			}
			rate := float64(available) / float64(total)
			if rate < 0 {
				rate = 0
			}
			if rate > 1 {
				rate = 1
			}
			seats := total
			shows[idx].Seats = &seats
			shows[idx].RemainRate = model.SomeNullable(rate)
			shows[idx].SoldOut = available <= 0
		}(i)
	}
	wg.Wait()
}
