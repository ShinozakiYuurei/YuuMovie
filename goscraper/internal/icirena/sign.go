package icirena

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strings"
)

// canonical builds the string the signature is computed over.
//
// The platform sorts the parameter names, then concatenates key+value for
// every one that is neither null, undefined nor an empty string. Sorting is not
// cosmetic: it is what makes the signature match on the far side.
//
// Objects are inserted as compact JSON, but no parameter sent by this scraper
// is an object, so the values are plain strings here.
func canonical(prefix string, params map[string]string) string {
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var b strings.Builder
	b.WriteString(prefix)
	for _, k := range keys {
		v := params[k]
		if v == "" {
			continue
		}
		b.WriteString(k)
		b.WriteString(v)
	}
	return b.String()
}

// sign returns the uppercase hex HMAC-SHA256 the API expects.
func sign(message string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(message))
	return strings.ToUpper(hex.EncodeToString(mac.Sum(nil)))
}
