// Command enrich-run refreshes the cached IMDb and Douban scores with the Go
// port, writing the cache to a chosen path so it can be diffed against the Node
// output.
//
// The switches mirror scrapers/enrich.js:
//
//	enrich-run <root> <out.json>            incremental
//	enrich-run <root> <out.json> -limit 20  only the first 20 films
//	enrich-run <root> <out.json> -force     refresh scores, ignoring freshness
//	enrich-run <root> <out.json> -dry       print the plan, send nothing
//	enrich-run <root> <out.json> -douban-only / -no-douban
//	enrich-run <root> <out.json> -only a,b   restrict to titles containing a or b
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/enrich"
)

func main() {
	root := flag.String("root", ".", "project root holding data/")
	out := flag.String("out", "", "write the resulting cache here as JSON")
	limit := flag.Int("limit", 0, "only touch this many films")
	only := flag.String("only", "", "comma-separated title fragments")
	dry := flag.Bool("dry", false, "print the plan and send nothing")
	force := flag.Bool("force", false, "refresh scores, ignoring cache freshness")
	refreshDays := flag.Int("refresh-days", 3, "IMDb freshness window in days")
	doubanDays := flag.Int("douban-refresh-days", 14, "Douban freshness window in days")
	noDouban := flag.Bool("no-douban", false, "turn Douban off")
	doubanOnly := flag.Bool("douban-only", false, "refresh Douban and leave IMDb alone")
	flag.Parse()

	var filters []string
	if *only != "" {
		for _, part := range strings.Split(*only, ",") {
			if trimmed := strings.TrimSpace(part); trimmed != "" {
				filters = append(filters, trimmed)
			}
		}
	}

	opts := enrich.Options{
		Limit:             *limit,
		Only:              filters,
		Dry:               *dry,
		ForceRefresh:      *force,
		RefreshDays:       *refreshDays,
		DoubanRefreshDays: *doubanDays,
		NoDouban:          *noDouban,
		DoubanOnly:        *doubanOnly,
		Log:               func(line string) { fmt.Println(line) },
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Minute)
	defer cancel()

	start := time.Now()
	runner := enrich.NewRunner(*root, opts)
	result, err := runner.Run(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, "enrich failed:", err)
		os.Exit(1)
	}
	fmt.Printf("planned=%d work=%d processed=%d imdb=%d douban=%d reused=%d in %s\n",
		result.Planned, result.Work, result.Processed,
		result.IMDBHits, result.DoubanHits, result.Reused,
		time.Since(start).Round(time.Second))

	if *out != "" {
		raw, err := runner.CacheJSON()
		if err != nil {
			fmt.Fprintln(os.Stderr, "encode failed:", err)
			os.Exit(1)
		}
		var buf []byte
		if *dry || *force {
			buf, err = json.MarshalIndent(json.RawMessage(raw), "", " ")
		} else {
			buf = raw
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, "format failed:", err)
			os.Exit(1)
		}
		if err := os.WriteFile(*out, append(buf, '\n'), 0o644); err != nil {
			fmt.Fprintln(os.Stderr, "write failed:", err)
			os.Exit(1)
		}
		fmt.Println("wrote " + *out)
	}
	_ = strconv.Itoa
}
