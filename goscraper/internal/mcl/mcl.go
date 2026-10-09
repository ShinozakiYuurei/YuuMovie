// Package mcl scrapes the MCL circuit (美樂戲院).
//
// Ported from scrapers/mcl.js. The site is only reachable from Hong Kong, so
// every request goes through the proxy named by MCL_PROXY; the fetch package
// reads the same environment variable.
//
// Three details are easy to get wrong and are called out where they happen:
// the show description carries no year, the `r` field is the share of seats
// STILL FREE rather than the share sold, and the `i` field mixes a synopsis
// with gift-redemption terms that have to be cut off.
package mcl

import (
	"os"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/fetch"
)

// Base is the circuit's site root.
const Base = "https://www.mclcinema.com"

// apiRoot holds the three JSON endpoints the site exposes.
const apiRoot = Base + "/MCLWebAPI2"

// Source is the circuit key used in generated ids.
const Source = "mcl"

// lang is the locale every endpoint is asked for.
const lang = "zh-TW"

// listAttempts is how often a list endpoint is retried when the site answers a
// rate-limit redirect.
const listAttempts = 3

// hkCategories are the ratings the site uses that Hong Kong recognises;
// anything else is treated as absent rather than shown verbatim.
var hkCategories = map[string]bool{"I": true, "IIA": true, "IIB": true, "III": true}

// verifiedEnglishTitles fills in the two films whose English titles were checked
// one by one against MCL's own credits and TMDB. MCL publishes no English name,
// and adding a guess for any other film would be worse than leaving it empty.
var verifiedEnglishTitles = map[string]string{
	"14743|以你的名字呼喚我 (特別放映)":                "Call Me by Your Name",
	"14855|《情書》30周年修復版 (「相約在The One」特別放映)": "Love Letter",
}

// Scraper holds the HTTP client so tests can substitute one.
type Scraper struct {
	Client *fetch.Client

	// detailClient fetches the per-film metadata. It does not retry: the detail
	// endpoint is slow and the caller already runs on a time budget, so a retried
	// request would burn three timeouts instead of one and blow the budget.
	detailClient *fetch.Client
}

// New builds a Scraper using the proxy from MCL_PROXY, if set.
func New() *Scraper {
	proxy := fetch.WithProxy(os.Getenv("MCL_PROXY"))
	return &Scraper{
		Client:       fetch.New(proxy),
		detailClient: fetch.New(proxy, fetch.WithRetries(0)),
	}
}
