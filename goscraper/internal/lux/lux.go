package lux

import (
	"context"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/devalue"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/fetch"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/model"
)

// cinemaID is the single venue this circuit operates.
const cinemaID = "0ab2c645-1ba1-4b43-94ce-da1d2cf78077"

// site is the site root. The venue slug is part of the URL the site expects.
const site = "https://hkmovie6.com"

// cinemaURL is the venue page. It is the only URL this circuit reads HTML from.
const cinemaURL = site + "/cinema/" + cinemaID + "/寶石戲院"

// sourceKey is the circuit key used in generated ids.
const sourceKey = "lux"

// venueID is the single cinema id this circuit writes.
const venueID = sourceKey + "-1"

// defaultAddress and defaultName are what the site itself uses, kept as the
// fallback for a page that omits them rather than as a hardcoded answer.
const (
	defaultName    = "寶石戲院"
	defaultAddress = "九龍紅磡寶其利街2J號"
)

// mapQueryName is what the venue is searched as on a map. The site publishes no
// map link for this address, so the JS built a search rather than a pin.
const mapQueryName = "Lux Theatre"

// dayConcurrency is how many days are requested at once. The Node scraper used
// three; the API tolerates it and it keeps the circuit under two seconds.
const dayConcurrency = 3

// requestTimeout bounds one API call. It matches the Node scraper's 20s budget.
const requestTimeout = 20 * time.Second

// tokenRe pulls the JWT out of the anonymous response.
//
// The token arrives as bare ASCII inside a protobuf field with no descriptor of
// its own, so it is matched as bytes rather than read by field number. That is
// also why the pattern is applied to the raw message: it must not depend on
// where in the field list the bytes sit.
var tokenRe = regexp.MustCompile("eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+")

// scriptRe pulls the payload script out of a page.
var scriptRe = regexp.MustCompile("(?is)<script[^>]*>(.*?)</script>")

// Scraper holds the HTTP clients so tests can substitute one.
type Scraper struct {
	// page fetches the venue page, which sits behind a challenge and so needs
	// the Hong Kong egress the same environment variable names for MCL.
	page *fetch.Client

	// api talks to the gRPC-Web host, which is reachable directly.
	api *grpcClient
}

// New builds a Scraper. The venue page goes through MCL_PROXY when it is set;
// without it the page answers a challenge and the circuit cannot run, which is
// worth saying plainly rather than returning an empty schedule.
func New() *Scraper {
	proxy := fetch.WithProxy(proxyURL())
	return &Scraper{
		page: fetch.New(proxy, fetch.WithTimeout(requestTimeout)),
		api:  newGRPCClient(),
	}
}

// proxyURL resolves the egress proxy, preferring a Lux-specific setting and
// falling back to the one the other Hong Kong-only circuit already uses.
func proxyURL() string {
	if value := strings.TrimSpace(os.Getenv("LUX_PROXY")); value != "" {
		return value
	}
	return os.Getenv("MCL_PROXY")
}

// cinemaPage is the part of the venue page's payload this circuit reads.
type cinemaPage struct {
	Name      string
	Address   string
	MapURL    string
	ShowDates []int64
}

// Scrape fetches the venue page for its address and dates, then asks the API
// for each day's showtimes.
func (s *Scraper) Scrape(ctx context.Context) (*model.Snapshot, error) {
	page, err := s.fetchPage(ctx)
	if err != nil {
		return nil, err
	}

	token, err := s.api.token(ctx)
	if err != nil {
		return nil, err
	}

	responses := s.fetchDays(ctx, token, page.ShowDates)
	snapshot, err := normalize(page, responses)
	if err != nil {
		return nil, err
	}
	if len(snapshot.Shows) == 0 {
		return nil, fmt.Errorf("Lux returned no showtimes")
	}
	return snapshot, nil
}

// fetchDays requests one day at a time, a few in parallel.
//
// A day that fails does not fail the run: the Node scraper let a single failed
// request reject the whole scrape, which meant one flaky day erased a schedule
// that had already been fetched. Here the surviving days are what count, and a
// total failure is reported by the caller's empty-shows check.
func (s *Scraper) fetchDays(ctx context.Context, token string, dates []int64) map[int64][]byte {
	type result struct {
		date    int64
		payload []byte
		err     error
	}

	jobs := make(chan int64)
	results := make(chan result, len(dates))
	var workers sync.WaitGroup
	for i := 0; i < dayConcurrency; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for date := range jobs {
				payload, err := s.api.call(ctx, schedulePath, schedulePayload(cinemaID, date), token)
				results <- result{date: date, payload: payload, err: err}
			}
		}()
	}

	go func() {
		for _, date := range dates {
			jobs <- date
		}
		close(jobs)
		workers.Wait()
		close(results)
	}()

	var failures int
	out := map[int64][]byte{}
	for item := range results {
		if item.err != nil {
			failures++
			continue
		}
		out[item.date] = item.payload
	}
	if failures > 0 && failures < len(dates) {
		fmt.Printf("[lux] %d of %d days failed, continuing with the rest\n", failures, len(dates))
	}
	return out
}

// fetchPage loads the venue page and decodes its embedded payload.
func (s *Scraper) fetchPage(ctx context.Context) (*cinemaPage, error) {
	body, err := s.page.Get(ctx, cinemaURL)
	if err != nil {
		return nil, fmt.Errorf("HK Movie 6 page: %w", err)
	}
	return parseCinemaPage(string(body))
}

// parseCinemaPage reads the venue's name, address and programmed days.
//
// The page is a Nuxt application like Golden Scene, so the state comes from the
// devalue payload rather than the markup, and it sits in the same data[0] slot.
func parseCinemaPage(html string) (*cinemaPage, error) {
	payload := ""
	for _, match := range scriptRe.FindAllStringSubmatch(html, -1) {
		if strings.Contains(match[1], "window.__NUXT__=") {
			payload = match[1]
			break
		}
	}
	if payload == "" {
		return nil, fmt.Errorf("HK Movie 6 page has no Nuxt payload")
	}

	value, err := devalue.Eval(payload)
	if err != nil {
		return nil, err
	}
	root, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("HK Movie 6 payload is not an object")
	}
	data, ok := root["data"].([]any)
	if !ok || len(data) == 0 {
		return nil, fmt.Errorf("HK Movie 6 payload has no data")
	}
	state, ok := data[0].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("HK Movie 6 payload data[0] is not an object")
	}

	cinema, _ := state["cinema"].(map[string]any)
	uuid, _ := cinema["uuid"].(string)
	if uuid != cinemaID {
		return nil, fmt.Errorf("HK Movie 6 page is not the %s cinema", defaultName)
	}

	page := &cinemaPage{
		Name:    textOrFirstString(cinema["name"]),
		Address: textOrFirstString(cinema["address"]),
		MapURL:  textOrFirstString(cinema["mapUrl"]),
	}
	if page.Name == "" {
		page.Name = defaultName
	}
	if page.Address == "" {
		page.Address = defaultAddress
	}

	raw, _ := state["showDates"].([]any)
	seen := map[int64]bool{}
	for _, item := range raw {
		date := int64(number(item))
		if date <= 0 || seen[date] {
			continue
		}
		seen[date] = true
		page.ShowDates = append(page.ShowDates, date)
	}
	if len(page.ShowDates) == 0 {
		return nil, fmt.Errorf("HK Movie 6 returned no cinema schedule dates")
	}
	sort.Slice(page.ShowDates, func(i, j int) bool { return page.ShowDates[i] < page.ShowDates[j] })
	return page, nil
}
