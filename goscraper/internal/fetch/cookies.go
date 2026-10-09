package fetch

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// GetWithCookieRedirect follows redirects manually while carrying cookies across
// hops, mirroring fetchWithCookieRedirect() in scrapers/other-circuits.js.
//
// Why manual: the ticket pages answer the first request with a 302 carrying
// AspxAutoDetectCookieSupport, and the real page only appears if that cookie
// comes back. Go's default redirect handling copies headers but the JS had to
// assemble a cookie jar by hand, so the same jar is built here to keep the two
// behaving alike. Four hops is the JS limit.
func (c *Client) GetWithCookieRedirect(ctx context.Context, rawURL string) ([]byte, error) {
	jar := map[string]string{}
	current := rawURL
	for hop := 0; hop < 4; hop++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, current, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", c.ua)
		req.Header.Set("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")
		if len(jar) > 0 {
			req.Header.Set("Cookie", cookieHeader(jar))
		}

		// The client must not follow the redirect itself, or the cookie would be
		// lost before the next hop.
		noRedirect := &http.Client{
			Transport: c.hc.Transport,
			Timeout:   c.hc.Timeout,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		}
		resp, err := noRedirect.Do(req)
		if err != nil {
			return nil, err
		}

		for _, line := range resp.Header.Values("Set-Cookie") {
			name, value, ok := parseSetCookie(line)
			if ok {
				jar[name] = value
			}
		}

		switch resp.StatusCode {
		case http.StatusMovedPermanently, http.StatusFound, http.StatusSeeOther,
			http.StatusTemporaryRedirect, http.StatusPermanentRedirect:
			location := resp.Header.Get("Location")
			io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
			resp.Body.Close()
			if location == "" {
				return nil, &ErrStatus{URL: current, Status: resp.StatusCode}
			}
			next, err := url.Parse(location)
			if err != nil {
				return nil, err
			}
			base, err := url.Parse(current)
			if err != nil {
				return nil, err
			}
			current = base.ResolveReference(next).String()
			continue
		}

		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
			return nil, &ErrStatus{URL: current, Status: resp.StatusCode}
		}
		return io.ReadAll(resp.Body)
	}
	return nil, &ErrStatus{URL: rawURL, Status: 0}
}

// PostForm posts a URL-encoded body, mirroring fetchQuickTickets().
func (c *Client) PostForm(ctx context.Context, rawURL, body string) ([]byte, error) {
	return c.do(ctx, http.MethodPost, rawURL, map[string]string{
		"Content-Type":     "application/x-www-form-urlencoded; charset=UTF-8",
		"X-Requested-With": "XMLHttpRequest",
	}, []byte(body))
}

func cookieHeader(jar map[string]string) string {
	parts := make([]string, 0, len(jar))
	for k, v := range jar {
		parts = append(parts, k+"="+v)
	}
	return strings.Join(parts, "; ")
}

// parseSetCookie pulls the name and value out of one Set-Cookie line, ignoring
// the attributes. The JS did the same: it split on the first ';' and then on the
// first '='.
func parseSetCookie(line string) (string, string, bool) {
	pair := line
	if i := strings.Index(line, ";"); i >= 0 {
		pair = line[:i]
	}
	eq := strings.Index(pair, "=")
	if eq <= 0 {
		return "", "", false
	}
	return strings.TrimSpace(pair[:eq]), pair[eq+1:], true
}
