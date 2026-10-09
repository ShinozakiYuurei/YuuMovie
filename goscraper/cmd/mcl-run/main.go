// Command mcl-run scrapes the live MCL schedule with the Go port and writes it
// as JSON so it can be diffed against the Node output.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/mcl"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	start := time.Now()
	snap, err := mcl.New().Scrape(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, "scrape failed:", err)
		os.Exit(1)
	}
	fmt.Printf("movies=%d cinemas=%d shows=%d in %s\n",
		len(snap.Movies), len(snap.Cinemas), len(snap.Shows),
		time.Since(start).Round(time.Millisecond))

	out := "C:/Users/Yuurei/hkmovie-lab/tmp/mcl-go.json"
	if len(os.Args) > 1 {
		out = os.Args[1]
	}
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
