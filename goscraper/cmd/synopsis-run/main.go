// Command synopsis-run fills the cached synopses with the Go port, writing the
// cache to a chosen path so it can be diffed against the Node output.
//
// The switches mirror scrapers/synopsis.js:
//
//	synopsis-run <root> <out.json>            fill the increment
//	synopsis-run <root> <out.json> -limit 10  only the first ten films
//	synopsis-run <root> <out.json> -force     re-check everything
//	synopsis-run <root> <out.json> -dry       print the plan, send nothing
//	synopsis-run <root> <out.json> -only a,b  restrict to titles containing a or b
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/synopsis"
)

func main() {
	root := flag.String("root", ".", "project root holding data/")
	out := flag.String("out", "", "write the resulting cache here as JSON")
	limit := flag.Int("limit", 0, "only touch this many films")
	only := flag.String("only", "", "comma-separated title fragments")
	dry := flag.Bool("dry", false, "print the plan and send nothing")
	force := flag.Bool("force", false, "re-check everything, ignoring cache freshness")
	gap := flag.Int("gap-ms", 0, "pause between requests; 0 uses the default")
	flag.Parse()

	rootVal := *root
	outVal := *out
	if args := flag.Args(); len(args) > 0 {
		rootVal = args[0]
		if len(args) > 1 {
			outVal = args[1]
		}
	}
	forceVal := *force || os.Getenv("SYNOPSIS_FORCE") == "1" || os.Getenv("FORCE") == "1"

	var filters []string
	if *only != "" {
		for _, part := range strings.Split(*only, ",") {
			if trimmed := strings.TrimSpace(part); trimmed != "" {
				filters = append(filters, trimmed)
			}
		}
	}

	opts := synopsis.Options{
		Limit:        *limit,
		Only:         filters,
		Dry:          *dry,
		ForceRefresh: forceVal,
		GapMS:        *gap,
		Log:          func(line string) { fmt.Println(line) },
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Minute)
	defer cancel()

	start := time.Now()
	runner := synopsis.NewRunner(rootVal, opts)
	result, err := runner.Run(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, "synopsis failed:", err)
		os.Exit(1)
	}
	fmt.Printf("planned=%d processed=%d found=%d in %s\n",
		result.Planned, result.Processed, result.Found, time.Since(start).Round(time.Second))

	if outVal != "" {
		raw, err := runner.CacheJSON()
		if err != nil {
			fmt.Fprintln(os.Stderr, "encode failed:", err)
			os.Exit(1)
		}
		if err := os.WriteFile(outVal, raw, 0o644); err != nil {
			fmt.Fprintln(os.Stderr, "write failed:", err)
			os.Exit(1)
		}
		fmt.Println("wrote " + outVal)
	}
}
