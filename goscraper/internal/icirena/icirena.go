// Package icirena scrapes the three circuits that share the icirena booking
// platform: Emperor, Cinema City and Bestar.
//
// Ported from scrapers/icirena-http.js (transport) and scrapers/icirena.js
// (normalisation). The platform used to need a headless browser because the
// signature was computed in page JavaScript; that was reverse-engineered into
// HMAC-SHA256 over a canonical concatenation of the request parameters, which
// is what this package does.
//
// Two details are load-bearing and are called out where they matter: the
// schedule endpoint needs an explicit showDate or it returns a silent empty
// result, and seatRate is the percentage ALREADY SOLD rather than the share
// still available.
package icirena

import (
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/model"
)

// apiURL is the platform's single sync endpoint.
const apiURL = "https://gopesa-api.icirena.ai/sync"

// secret signs every request. It is the platform's public web-app secret, taken
// from the site's own bundle.
const secret = "3VIDRSDxD0Ck2b6e9K0RaB9Xo5s81tep"

// appKey is the public application identifier sent with every call.
const appKey = "500000"

// API method names.
const (
	methodCinemas    = "gop.alipic.icirena.own.cinema.getCinemas"
	methodShowing    = "gop.alipic.icirena.own.film.showing"
	methodComingSoon = "gop.alipic.icirena.own.film.comingsoon"
	methodSchedule   = "gop.alipic.icirena.own.filmschedule.list"
)

// Config describes one circuit on the platform.
type Config struct {
	// Key is the circuit key used in generated ids: emperor, cinemacity, bestar.
	Key string
	// Name is the circuit's display name, used in progress output only.
	Name string
	// Base is the public site, used for Origin, Referer and booking links.
	Base string
	// ChannelCode identifies the tenant to the platform.
	ChannelCode string
}

// Channels lists the three circuits, keyed by circuit name.
var Channels = map[string]Config{
	"emperor": {
		Key:         "emperor",
		Name:        "英皇戲院",
		Base:        "https://www.emperorcinemas.com",
		ChannelCode: "ECML_WEB_PROD_S_MPS",
	},
	"cinemacity": {
		Key:         "cinemacity",
		Name:        "Cinema City",
		Base:        "https://www.cinemacity.com.hk",
		ChannelCode: "CICI_WEB_PROD_S_MPS",
	},
	"bestar": {
		Key:         "bestar",
		Name:        "星達院線",
		Base:        "https://www.bestarfilm.hk",
		ChannelCode: "XYHK_WEB_PROD_S_MPS",
	},
}

// Source maps a circuit key onto the model constant used in its ids.
func Source(cfg Config) model.Source {
	switch cfg.Key {
	case "emperor":
		return model.SourceEmperor
	case "cinemacity":
		return model.SourceCinemaCity
	case "bestar":
		return model.SourceBestar
	}
	return model.Source(cfg.Key)
}
