package icirena

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/scrapeutil"
)

// Scraper talks to the platform for one channel.
type Scraper struct {
	Cfg    Config
	Client *http.Client

	concurrency int
	progress    func(string)

	// maxMovies caps the schedule fan-out; 0 means every film.
	maxMovies int
	// withSchedule can be turned off to fetch the lists only.
	withSchedule bool
}

// Options carries the knobs a run may want to change.
type Options struct {
	// Concurrency bounds the schedule fan-out.
	Concurrency int
	// MaxMovies caps the films whose schedules are fetched; 0 means all.
	MaxMovies int
	// WithSchedule can be turned off to fetch lists only.
	WithSchedule bool
	// Progress, when set, receives one line per milestone.
	Progress func(string)
}

// New builds a Scraper for the named channel.
func New(cfg Config, opts Options) *Scraper {
	concurrency := opts.Concurrency
	if concurrency < 1 {
		concurrency = 6
	}
	progress := opts.Progress
	if progress == nil {
		progress = func(string) {}
	}
	return &Scraper{
		Cfg:          cfg,
		Client:       &http.Client{Timeout: 30 * time.Second},
		concurrency:  concurrency,
		progress:     progress,
		maxMovies:    opts.MaxMovies,
		withSchedule: opts.WithSchedule,
	}
}

// ScheduleDays is how many days of screenings to request.
//
// The window is not uniform across films: a popular title usually runs for five
// days, while a one-off event may not start until the fifteenth. Twenty-one days
// covers the real range without flooding the API.
func ScheduleDays() int {
	if v := os.Getenv("ICIRENA_DAYS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return 21
}

// userAgent is the browser identity the site expects.
const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
	"(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

// bizValue is the envelope the platform wraps every payload in.
type bizValue struct {
	Result struct {
		BizCode  json.RawMessage `json:"bizCode"`
		BizValue json.RawMessage `json:"bizValue"`
	} `json:"result"`
}

// todayHK is the current date in Hong Kong, matching hkToday().
func todayHK() string { return scrapeutil.TodayHKT() }

// addDays offsets a YYYY-MM-DD date by n days.
func addDays(date string, n int) string {
	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		return date
	}
	return t.AddDate(0, 0, n).Format("2006-01-02")
}

// callOnce performs one signed request.
//
// The signature covers the query parameters, the body parameters and the method
// name merged into a single map, which is why all three are merged before
// signing rather than signed separately.
func (s *Scraper) callOnce(ctx context.Context, method string, extra map[string]string) (*bizValue, error) {
	timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)

	query := map[string]string{
		"app_key":     appKey,
		"sign_method": "sha256",
		"timestamp":   timestamp,
		"format":      "json",
		"simplify":    "true",
	}

	data := map[string]string{
		"empCode":     "",
		"leaseCode":   "",
		"channelCode": s.Cfg.ChannelCode,
		"larkSid":     "",
		"version":     "H5",
		"appVersion":  "H5_5.0",
		"__cv__":      "WEBSITE",
	}
	for k, v := range extra {
		data[k] = v
	}

	signed := make(map[string]string, len(query)+len(data)+1)
	for k, v := range query {
		signed[k] = v
	}
	for k, v := range data {
		signed[k] = v
	}
	signed["method"] = method
	signed["sign"] = sign(canonical("", signed))

	values := url.Values{}
	values.Set("method", method)
	for k, v := range query {
		values.Set(k, v)
	}
	values.Set("sign", signed["sign"])

	body := url.Values{}
	for k, v := range data {
		body.Set(k, v)
	}

	target := apiURL + "?" + values.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, strings.NewReader(body.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Origin", s.Cfg.Base)
	req.Header.Set("Referer", s.Cfg.Base+"/")

	resp, err := s.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("%s → HTTP %d: %s", method, resp.StatusCode, snippet(raw))
	}

	var out bizValue
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("%s → 非 JSON 响应: %s", method, snippet(raw))
	}
	return &out, nil
}

// call retries a request: the endpoint intermittently resets the connection
// while rate limiting, and one retry recovers from it.
func (s *Scraper) call(ctx context.Context, method string, extra map[string]string, tries int) (*bizValue, error) {
	if tries < 1 {
		tries = 1
	}
	var lastErr error
	for attempt := 0; attempt < tries; attempt++ {
		out, err := s.callOnce(ctx, method, extra)
		if err == nil {
			return out, nil
		}
		lastErr = err
		if attempt == tries-1 {
			break
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(time.Duration(600*(attempt+1)) * time.Millisecond):
		}
	}
	return nil, lastErr
}

// biz decodes one method's payload into v. An absent result is not an error: the
// platform answers with bizCode 0 and no value for an empty window.
func (s *Scraper) biz(out *bizValue, v any) error {
	if out == nil || len(out.Result.BizValue) == 0 {
		return nil
	}
	return json.Unmarshal(out.Result.BizValue, v)
}

// runPool runs fn for each index with a bounded number of goroutines.
func runPool(n, concurrency int, fn func(int)) {
	if n <= 0 {
		return
	}
	if concurrency < 1 {
		concurrency = 1
	}
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		sem <- struct{}{}
		go func(idx int) {
			defer wg.Done()
			defer func() { <-sem }()
			fn(idx)
		}(i)
	}
	wg.Wait()
}

// snippet trims a response body down to something loggable.
func snippet(raw []byte) string {
	text := strings.TrimSpace(string(raw))
	if len(text) > 120 {
		return text[:120]
	}
	return text
}
