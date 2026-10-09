// Command grabticks-run scrapes a GrabTicks circuit with the Go port and writes
// it as JSON for diffing against the Node output.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/grabticks"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: grabticks-run <cineart|cgv> [out.json]")
		os.Exit(2)
	}
	channel := os.Args[1]

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	start := time.Now()
	sc := grabticks.New()
	var snap any
	var err error
	switch channel {
	case "cineart":
		snap, err = sc.ScrapeCineArt(ctx)
	case "cgv":
		snap, err = sc.ScrapeCGV(ctx, 0)
	default:
		fmt.Fprintln(os.Stderr, "unknown channel:", channel)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "scrape failed:", err)
		os.Exit(1)
	}
	fmt.Printf("%s done in %s\n", channel, time.Since(start).Round(time.Millisecond))

	if len(os.Args) > 2 {
		var buf bytes.Buffer
		enc := json.NewEncoder(&buf)
		enc.SetIndent("", " ")
		if err := enc.Encode(snap); err != nil {
			fmt.Fprintln(os.Stderr, "encode failed:", err)
			os.Exit(1)
		}
		if err := os.WriteFile(os.Args[2], buf.Bytes(), 0o644); err != nil {
			fmt.Fprintln(os.Stderr, "write failed:", err)
			os.Exit(1)
		}
		fmt.Println("wrote " + os.Args[2])
	}
}
