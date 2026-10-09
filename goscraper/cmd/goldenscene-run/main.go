// Command goldenscene-run scrapes the live Golden Scene schedule with the Go
// port and writes it as JSON for a diff against the Node output.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/goldenscene"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	maxPages := 0
	out := ""
	for _, arg := range os.Args[1:] {
		if n, err := strconv.Atoi(arg); err == nil {
			maxPages = n
			continue
		}
		out = arg
	}

	start := time.Now()
	snap, err := goldenscene.New().Scrape(ctx, maxPages)
	if err != nil {
		fmt.Fprintln(os.Stderr, "scrape failed:", err)
		os.Exit(1)
	}
	fmt.Printf("movies=%d cinemas=%d shows=%d in %s\n",
		len(snap.Movies), len(snap.Cinemas), len(snap.Shows),
		time.Since(start).Round(time.Millisecond))

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
