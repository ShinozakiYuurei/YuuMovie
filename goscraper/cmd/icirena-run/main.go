// Command icirena-run scrapes the icirena circuits (emperor, cinemacity,
// bestar) with the Go port and writes them as JSON for a diff against Node.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/icirena"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/model"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()

	channels := []string{"emperor", "cinemacity", "bestar"}
	out := ""
	if len(os.Args) > 1 {
		channels = os.Args[1:]
	}

	all := model.Result{
		Movies:  []model.Movie{},
		Shows:   []model.Show{},
		Cinemas: []model.Cinema{},
	}

	for _, key := range channels {
		cfg, ok := icirena.Channels[key]
		if !ok {
			fmt.Fprintln(os.Stderr, "unknown channel: "+key)
			os.Exit(1)
		}
		t0 := time.Now()
		scraper := icirena.New(cfg, icirena.Options{
			WithSchedule: true,
			Concurrency:  6,
			Progress:     func(msg string) { fmt.Println("  " + msg) },
		})
		snap, err := scraper.Scrape(ctx)
		if err != nil {
			fmt.Fprintln(os.Stderr, key+" failed: "+err.Error())
			os.Exit(1)
		}
		fmt.Printf("%s: movies=%d cinemas=%d shows=%d in %s\n",
			key, len(snap.Movies), len(snap.Cinemas), len(snap.Shows),
			time.Since(t0).Round(time.Millisecond))

		all.Movies = append(all.Movies, snap.Movies...)
		all.Cinemas = append(all.Cinemas, snap.Cinemas...)
		all.Shows = append(all.Shows, snap.Shows...)
	}

	sort.SliceStable(all.Movies, func(i, j int) bool { return all.Movies[i].ID < all.Movies[j].ID })
	sort.SliceStable(all.Cinemas, func(i, j int) bool { return all.Cinemas[i].ID < all.Cinemas[j].ID })
	sort.SliceStable(all.Shows, func(i, j int) bool { return all.Shows[i].ID < all.Shows[j].ID })

	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetIndent("", " ")
	if err := enc.Encode(all); err != nil {
		fmt.Fprintln(os.Stderr, "encode failed:", err)
		os.Exit(1)
	}
	target := out
	if target == "" {
		target = "C:/Users/Yuurei/hkmovie-lab/tmp/icirena-go.json"
	}
	if err := os.WriteFile(target, buf.Bytes(), 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "write failed:", err)
		os.Exit(1)
	}
	fmt.Printf("TOTAL movies=%d cinemas=%d shows=%d\nwrote %s\n",
		len(all.Movies), len(all.Cinemas), len(all.Shows), target)
}
