// Package synopsis ports scrapers/synopsis.js: film synopses for the listings that
// do not carry any.
//
// Ported from the JavaScript, with the same reasoning for a separate cache: the
// venue listings are rewritten wholesale on every scrape, and text from an
// outside source does not belong in that layer.
//
// Three sources, in this order (the user chose it on 2026-10-04):
//
//  1. wmoov.com  \u2014 the distributor's own copy, which is the one that was asked for
//  2. kinohk.com \u2014 server-rendered and its robots.txt explicitly welcomes crawlers,
//     with attribution
//  3. hkmovie6.com \u2014 a Nuxt site but server-rendered, so the markup is enough
//
// wmoov and hkmovie6 are behind Cloudflare: they answer 403 from this machine and
// 200 from Hong Kong, so both go through the egress proxy. kinohk needs none.
//
// The judgement in this file is which source entry is the same film, and that
// comes down to two things: matchIndex, which gives ground in three steps, and
// TitleAgrees, which is the last gate and the reason a wrong film's synopsis
// never gets attached.
package synopsis

import (
	"context"
	"os"
	"strings"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/fetch"
)

// requestTimeout bounds one page fetch.
const requestTimeout = 20 * time.Second

// fetchAttempts is how often a page is retried before the film is given up on.
const fetchAttempts = 3

// retryPause grows with the attempt number, so a site that is briefly down is not
// hammered the same way three times running.
const retryPause = 600 * time.Millisecond

// Scraper holds the HTTP clients so tests can substitute one.
type Scraper struct {
	// Site fetches the public pages. wmoov and hkmovie6 need the Hong Kong egress
	// because Cloudflare answers this machine with 403; kinohk goes through the
	// same client and does not care either way.
	Site *fetch.Client
}

// New builds a Scraper using the proxy named by SYNOPSIS_PROXY, falling back to
// the one the other Hong Kong-only circuits already use.
func New() *Scraper {
	proxy := fetch.WithProxy(proxyURL())
	return &Scraper{Site: fetch.New(proxy, fetch.WithTimeout(requestTimeout), fetch.WithUserAgent(browserAgent))}
}

// browserAgent is the desktop Chrome agent the JavaScript sent. Both sites serve
// different markup to unknown agents, so it is part of the contract rather than a
// default.
const browserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
	"(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

// getText fetches one page, retrying transient failures.
//
// A 4xx is a permanent answer and is not retried, because a missing page will not
// appear on the next attempt and three quick requests only make the failure more
// likely to be rate limiting rather than a genuine 404.
func (s *Scraper) getText(ctx context.Context, url string) (string, error) {
	var lastErr error
	for attempt := 0; attempt < fetchAttempts; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-time.After(retryPause * time.Duration(attempt)):
			}
		}
		body, err := s.Site.GetWithHeaders(ctx, url, map[string]string{"Accept-Language": "zh-HK,zh;q=0.9"})
		if err == nil {
			return string(body), nil
		}
		lastErr = err
		if fetch.IsNotFound(err) {
			return "", err
		}
	}
	return "", lastErr
}

// proxyURL resolves the egress proxy, preferring a synopsis-specific setting.
func proxyURL() string {
	if value := strings.TrimSpace(os.Getenv("SYNOPSIS_PROXY")); value != "" {
		return value
	}
	if value := strings.TrimSpace(os.Getenv("LUX_PROXY")); value != "" {
		return value
	}
	return strings.TrimSpace(os.Getenv("MCL_PROXY"))
}
