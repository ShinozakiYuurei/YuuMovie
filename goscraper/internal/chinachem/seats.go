package chinachem

import (
	"context"
	"sync"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/model"
)

// fillSeatAvailability counts seats for every show, mirroring
// fillSeatAvailability() in scrapers/other-circuits.js.
//
// It costs one extra request per show (93 on a real page), so it runs with a
// small worker pool. A show whose request fails keeps null seats and no remain
// rate rather than being dropped: the JS swallows the error the same way, and
// dropping shows would make the schedule look emptier than it really is.
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
			// total counts every seat slot, available only those marked AV.
			total := len(availAnyRe.FindAllString(page, -1))
			available := len(availRe.FindAllString(page, -1))
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
			shows[idx].RemainRate = &rate
			shows[idx].SoldOut = available <= 0
		}(i)
	}
	wg.Wait()
}
