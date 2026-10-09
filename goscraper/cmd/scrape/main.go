// Command scrape runs the whole pipeline and writes data/movies.json,
// data/shows.json, data/cinemas.json and data/meta.json.
//
// It replaces scrape.js. The environment variables are the same ones the deploy
// scripts already set, so switching over needs no change on the VPS:
//
//	ONLY=broadway,mcl   scrape        only these circuits
//	NO_SCHEDULE=1       scrape        skip the per-film schedule pass
//	MAX_MOVIES=N        scrape        cap the films each circuit walks
//	MCL_PROXY=...       scrape        Hong Kong egress for MCL
package main

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/runner"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "✖ "+err.Error())
		os.Exit(1)
	}
}

func run() error {
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "data"
	}

	opts := runner.Options{
		DataDir:      dataDir,
		Only:         splitList(os.Getenv("ONLY")),
		MaxMovies:    intEnv("MAX_MOVIES"),
		SkipSchedule: os.Getenv("NO_SCHEDULE") == "1",
		Concurrency:  intEnv("SCRAPE_CONCURRENCY"),
		Log:          func(line string) { fmt.Println(line) },
	}

	// The scrape is the slow part of a deploy, so give it room but not forever:
	// a circuit that hangs should fail into its snapshot rather than block the
	// publish.
	timeout := time.Duration(intEnv("SCRAPE_TIMEOUT_MIN")) * time.Minute
	if timeout <= 0 {
		timeout = 45 * time.Minute
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	meta, err := runner.Run(ctx, opts)
	if err != nil {
		return err
	}

	fmt.Println("  " + formatCounts(meta.Counts))
	if meta.Integrity != nil {
		fmt.Printf("  完整性: orphanShows=%d showsWithoutBookingUrl=%d moviesWithoutPoster=%d cinemasWithoutAddress=%d\n",
			meta.Integrity.OrphanShows,
			meta.Integrity.ShowsWithoutBookingURL,
			meta.Integrity.MoviesWithoutPoster,
			meta.Integrity.CinemasWithoutAddress)
	}
	if len(meta.Errors) > 0 {
		fmt.Printf("  錯誤 %d 項\n", len(meta.Errors))
		for _, e := range meta.Errors {
			fmt.Printf("    %s: %s\n", e.Source, e.Error)
		}
	}

	return nil
}

func splitList(value string) []string {
	var out []string
	for _, part := range strings.Split(value, ",") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func intEnv(name string) int {
	n, err := strconv.Atoi(strings.TrimSpace(os.Getenv(name)))
	if err != nil {
		return 0
	}
	return n
}

func formatCounts(c struct {
	Movies   int `json:"movies"`
	Showing  int `json:"showing"`
	Upcoming int `json:"upcoming"`
	Cinemas  int `json:"cinemas"`
	Shows    int `json:"shows"`
}) string {
	return fmt.Sprintf(`{"movies":%d,"showing":%d,"upcoming":%d,"cinemas":%d,"shows":%d}`,
		c.Movies, c.Showing, c.Upcoming, c.Cinemas, c.Shows)
}
