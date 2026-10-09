// Command lumen-run scrapes the live Lumen schedule with the Go port and writes
// it as JSON so it can be diffed against the Node output.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/lumen"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()

	start := time.Now()
	snap, err := lumen.New().Scrape(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, "scrape failed:", err)
		os.Exit(1)
	}
	fmt.Printf("movies=%d cinemas=%d shows=%d in %s\n",
		len(snap.Movies), len(snap.Cinemas), len(snap.Shows), time.Since(start).Round(time.Millisecond))

	var priced, soldOut int
	for _, s := range snap.Shows {
		if s.Price != nil {
			priced++
		}
		if s.SoldOut != nil && *s.SoldOut {
			soldOut++
		}
	}
	fmt.Printf("shows with price=%d soldOut=%d\n", priced, soldOut)

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
