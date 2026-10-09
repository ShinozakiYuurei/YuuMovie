// Command chinachem-run scrapes the live Chinachem schedule with the Go port
// and writes it as JSON, so the output can be diffed against the Node
// implementation's data/sources/chinachem.json.
//
// It is a manual cross-check tool, not part of the deploy path: the site still
// runs scrape.js. Once every circuit is ported this becomes the entry point.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/chinachem"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	start := time.Now()
	snap, err := chinachem.New().Scrape(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, "scrape failed:", err)
		os.Exit(1)
	}

	fmt.Printf("movies=%d cinemas=%d shows=%d in %s\n",
		len(snap.Movies), len(snap.Cinemas), len(snap.Shows), time.Since(start).Round(time.Millisecond))

	// Seat stats are the part most likely to differ, so report them explicitly.
	var withSeats, soldOut int
	for _, s := range snap.Shows {
		if s.Seats != nil {
			withSeats++
		}
		if s.SoldOut {
			soldOut++
		}
	}
	fmt.Printf("shows with seats=%d soldOut=%d\n", withSeats, soldOut)

	// JSON goes to a file, not stdout: on Windows the shell redirects stdout as
	// UTF-16, which makes the output unparseable by the tools that diff it.
	if len(os.Args) > 1 {
		var buf bytes.Buffer
		enc := json.NewEncoder(&buf)
		enc.SetIndent("", " ")
		if err := enc.Encode(snap); err != nil {
			fmt.Fprintln(os.Stderr, "encode failed:", err)
			os.Exit(1)
		}
		if err := os.WriteFile(os.Args[1], buf.Bytes(), 0o644); err != nil {
			fmt.Fprintln(os.Stderr, "write failed:", err)
			os.Exit(1)
		}
		fmt.Println("wrote " + os.Args[1])
	}
}
