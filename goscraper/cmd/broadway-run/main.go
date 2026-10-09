// Command broadway-run scrapes the live Broadway schedule with the Go port
// and writes it as JSON so it can be diffed against the Node output.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/broadway"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()

	withDetails := true
	concurrency := 3
	out := ""
	for _, arg := range os.Args[1:] {
		switch arg {
		case "--no-details":
			withDetails = false
		default:
			if n, err := strconv.Atoi(arg); err == nil {
				concurrency = n
			} else {
				out = arg
			}
		}
	}

	start := time.Now()
	snap, upcoming, err := broadway.New().Scrape(ctx, withDetails, concurrency)
	if err != nil {
		fmt.Fprintln(os.Stderr, "scrape failed:", err)
		os.Exit(1)
	}
	snap.Movies = append(snap.Movies, upcoming...)
	fmt.Printf("movies=%d cinemas=%d shows=%d showing=%d upcoming=%d in %s\n",
		len(snap.Movies), len(snap.Cinemas), len(snap.Shows),
		len(snap.Movies)-len(upcoming), len(upcoming), time.Since(start).Round(time.Millisecond))

	if out != "" {
		var buf bytes.Buffer
		enc := json.NewEncoder(&buf)
		enc.SetIndent("", " ")
		if err := enc.Encode(snap); err != nil {
			fmt.Fprintln(os.Stderr, "encode failed:", err)
			os.Exit(1)
		}
		if err := os.WriteFile(out, buf.Bytes(), 0o644); err != nil {
			fmt.Fprintln(os.Stderr, "write failed:", err)
			os.Exit(1)
		}
		fmt.Println("wrote " + out)
	}
}
