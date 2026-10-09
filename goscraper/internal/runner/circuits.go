package runner

import (
	"context"
	"fmt"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/broadway"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/chinachem"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/goldenscene"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/grabticks"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/icirena"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/lumen"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/lux"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/mcl"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/model"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/newport"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/sunbeam"
)

// circuits lists every scrapeable source, in merge order.
//
// The order is part of the contract: when two circuits publish the same id, the
// earlier one wins, and the Node runner used this same order.
func circuits() []circuit {
	return []circuit{
		{
			Name:  string(model.SourceBroadway),
			Label: "百老匯",
			Scrape: func(ctx context.Context, opts Options) (*model.Snapshot, error) {
				concurrency := opts.Concurrency
				if concurrency < 1 {
					// Two, not five: on a 2C2G box a higher fan-out steals CPU
					// from everything else running there.
					concurrency = 2
				}
				snap, upcoming, err := broadway.New().Scrape(ctx, true, concurrency)
				if err != nil {
					return nil, err
				}
				snap.Movies = append(snap.Movies, upcoming...)
				return snap, nil
			},
		},
		{
			Name:  string(model.SourceMCL),
			Label: "MCL",
			Scrape: func(ctx context.Context, _ Options) (*model.Snapshot, error) {
				return mcl.New().Scrape(ctx)
			},
		},
		{
			Name:  string(model.SourceEmperor),
			Label: "英皇戲院（icirena）",
			Scrape: func(ctx context.Context, opts Options) (*model.Snapshot, error) {
				return scrapeIcirenaChannel(ctx, "emperor", opts)
			},
			NeedsSchedule: true,
		},
		{
			Name:  string(model.SourceCinemaCity),
			Label: "Cinema City（icirena）",
			Scrape: func(ctx context.Context, opts Options) (*model.Snapshot, error) {
				return scrapeIcirenaChannel(ctx, "cinemacity", opts)
			},
			NeedsSchedule: true,
		},
		{
			Name:  string(model.SourceBestar),
			Label: "星達院線（icirena）",
			Scrape: func(ctx context.Context, opts Options) (*model.Snapshot, error) {
				return scrapeIcirenaChannel(ctx, "bestar", opts)
			},
			NeedsSchedule: true,
		},
		{
			Name:  string(model.SourceCGV),
			Label: "CGV",
			Scrape: func(ctx context.Context, opts Options) (*model.Snapshot, error) {
				return grabticks.New().ScrapeCGV(ctx, opts.MaxMovies)
			},
		},
		{
			Name:  string(model.SourceChinachem),
			Label: " chinachem",
			Scrape: func(ctx context.Context, _ Options) (*model.Snapshot, error) {
				return chinachem.New().Scrape(ctx)
			},
		},
		{
			Name:  string(model.SourceCineArt),
			Label: "cineart",
			Scrape: func(ctx context.Context, _ Options) (*model.Snapshot, error) {
				return grabticks.New().ScrapeCineArt(ctx)
			},
		},
		{
			Name:  string(model.SourceGoldenScene),
			Label: "goldenscene",
			Scrape: func(ctx context.Context, opts Options) (*model.Snapshot, error) {
				return goldenscene.New().Scrape(ctx, opts.MaxMovies)
			},
		},
		{
			Name:  string(model.SourceLumen),
			Label: "lumen",
			Scrape: func(ctx context.Context, _ Options) (*model.Snapshot, error) {
				return lumen.New().Scrape(ctx)
			},
		},
		{
			Name:  string(model.SourceLux),
			Label: "lux",
			Scrape: func(ctx context.Context, _ Options) (*model.Snapshot, error) {
				return lux.New().Scrape(ctx)
			},
		},
		{
			Name:  string(model.SourceNewport),
			Label: "newport",
			Scrape: func(ctx context.Context, _ Options) (*model.Snapshot, error) {
				return newport.New().Scrape(ctx)
			},
		},
		{
			Name:  string(model.SourceSunbeam),
			Label: "sunbeam",
			Scrape: func(ctx context.Context, _ Options) (*model.Snapshot, error) {
				return sunbeam.New().Scrape(ctx)
			},
		},
	}
}

// scrapeIcirenaChannel runs one circuit on the shared booking platform.
func scrapeIcirenaChannel(ctx context.Context, key string, opts Options) (*model.Snapshot, error) {
	cfg, ok := icirena.Channels[key]
	if !ok {
		return nil, fmt.Errorf("未知院线: %s", key)
	}
	scraper := icirena.New(cfg, icirena.Options{
		WithSchedule: !opts.SkipSchedule,
		MaxMovies:    opts.MaxMovies,
		Progress: func(msg string) {
			if opts.Log != nil {
				opts.Log("  " + msg)
			}
		},
	})
	return scraper.Scrape(ctx)
}
