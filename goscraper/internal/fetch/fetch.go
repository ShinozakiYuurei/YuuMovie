// Package fetch is the shared HTTP layer for every circuit scraper.
//
// It exists so the circuit scrapers never touch net/http directly: retries,
// timeouts, the Hong Kong egress proxy and browser-ish headers are decided
// once here. Node's scrapers each hand-rolled this (mcl.js even lazy-loads
// https-proxy-agent for the same reason).
package fetch

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"time"
)

// Client wraps http.Client with retry and an optional proxy.
type Client struct {
	hc      *http.Client
	ua      string
	retries int
	// jitter delays retries so a rate-limited source is not hammered in lockstep.
	jitter func() time.Duration
}

// Option configures a Client.
type Option func(*Client)

// WithProxy routes requests through proxyURL (http://host:port). The MCL
// circuit needs a Hong Kong egress; every other circuit connects directly.
func WithProxy(proxyURL string) Option {
	return func(c *Client) {
		if proxyURL == "" {
			return
		}
		u, err := url.Parse(proxyURL)
		if err != nil {
			return
		}
		c.hc.Transport = &http.Transport{
			Proxy:               http.ProxyURL(u),
			MaxIdleConns:        32,
			MaxIdleConnsPerHost: 8,
			IdleConnTimeout:     60 * time.Second,
		}
	}
}

// WithTimeout overrides the per-request timeout.
func WithTimeout(d time.Duration) Option {
	return func(c *Client) { c.hc.Timeout = d }
}

// WithRetries sets how many extra attempts a failed request gets.
func WithRetries(n int) Option {
	return func(c *Client) { c.retries = n }
}

// WithUserAgent overrides the default desktop-Chrome UA.
func WithUserAgent(ua string) Option {
	return func(c *Client) { c.ua = ua }
}

// DefaultUserAgent is the UA the Node scrapers sent. Some circuits (MCL)
// serve different markup to unknown agents, so this is part of the contract.
const DefaultUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
	"(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

// New builds a Client. The default timeout is 30s, matching the Node side.
func New(opts ...Option) *Client {
	c := &Client{
		hc: &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{
				MaxIdleConns:        32,
				MaxIdleConnsPerHost: 8,
				IdleConnTimeout:     60 * time.Second,
			},
		},
		ua:      DefaultUserAgent,
		retries: 2,
		jitter:  func() time.Duration { return time.Duration(180+rand.Intn(240)) * time.Millisecond },
	}
	for _, o := range opts {
		o(c)
	}
	return c
}

// ErrStatus is returned for a non-2xx response, so callers can tell a 404
// from a network failure.
type ErrStatus struct {
	URL    string
	Status int
}

func (e *ErrStatus) Error() string { return fmt.Sprintf("GET %s: HTTP %d", e.URL, e.Status) }

// IsNotFound reports whether err is a 404/410, which circuits use to mean
// "this film is gone" rather than "the request failed".
func IsNotFound(err error) bool {
	var es *ErrStatus
	if errors.As(err, &es) {
		return es.Status == http.StatusNotFound || es.Status == http.StatusGone
	}
	return false
}

// Get fetches url and returns the body. It retries transient failures
// (network errors and 5xx) but never 4xx, which would just repeat.
func (c *Client) Get(ctx context.Context, rawURL string) ([]byte, error) {
	return c.do(ctx, http.MethodGet, rawURL, nil)
}

// GetWithHeaders is Get with extra request headers.
func (c *Client) GetWithHeaders(ctx context.Context, rawURL string, headers map[string]string) ([]byte, error) {
	return c.do(ctx, http.MethodGet, rawURL, headers)
}

// PostJSON posts body to rawURL with a JSON content type.
func (c *Client) PostJSON(ctx context.Context, rawURL string, body []byte) ([]byte, error) {
	return c.do(ctx, http.MethodPost, rawURL, map[string]string{
		"Content-Type": "application/json",
	}, body)
}

func (c *Client) do(ctx context.Context, method, rawURL string, headers map[string]string, body ...[]byte) ([]byte, error) {
	var lastErr error
	for attempt := 0; attempt <= c.retries; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(c.jitter()):
			}
		}
		data, err := c.once(ctx, method, rawURL, headers, body...)
		if err == nil {
			return data, nil
		}
		lastErr = err

		// A 4xx (other than 429) is a permanent answer: retrying cannot help.
		var es *ErrStatus
		if errors.As(err, &es) && es.Status >= 400 && es.Status < 500 && es.Status != http.StatusTooManyRequests {
			return nil, err
		}
	}
	return nil, lastErr
}

func (c *Client) once(ctx context.Context, method, rawURL string, headers map[string]string, body ...[]byte) ([]byte, error) {
	var rdr io.Reader
	if len(body) > 0 && len(body[0]) > 0 {
		rdr = newBytesReader(body[0])
	}
	req, err := http.NewRequestWithContext(ctx, method, rawURL, rdr)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", c.ua)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "zh-HK,zh;q=0.9,en;q=0.8")
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return nil, &ErrStatus{URL: rawURL, Status: resp.StatusCode}
	}
	return io.ReadAll(resp.Body)
}

// newBytesReader avoids importing bytes just for one reader.
func newBytesReader(b []byte) io.Reader { return &byteReader{b: b} }

type byteReader struct {
	b []byte
	i int
}

func (r *byteReader) Read(p []byte) (int, error) {
	if r.i >= len(r.b) {
		return 0, io.EOF
	}
	n := copy(p, r.b[r.i:])
	r.i += n
	return n, nil
}
