// Package lux scrapes the HK Movie 6 circuit, which covers one venue: 寶石戲院.
//
// Ported from the LUX section of scrapers/other-circuits.js. The shape of this
// circuit is unlike the other HTML scrapers: the page itself only supplies the
// venue's name and address plus the list of days it programs, and every film
// and every showtime comes from a gRPC-Web endpoint that speaks protobuf. No
// schema for that API was ever published, so internal/protobuf reads the wire
// format generically and the mapping below pins down the field numbers this
// circuit needs.
//
// Two details about the transport are worth knowing before changing anything:
//
//   - a failure is reported in the trailer frame, not the HTTP status, so a 200
//     on its own does not mean the call succeeded;
//   - the attendance ratio is encoded as an 8-byte little-endian value inside a
//     length-delimited field, which is why that one field is not a varint.
package lux

import (
	"context"
	"encoding/binary"
	"fmt"
	"regexp"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/fetch"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/protobuf"
)

// apiRoot is the gRPC-Web host. It is deliberately separate from the site host:
// the site HTML sits behind a challenge, the API does not, so the two need
// different transports.
const apiRoot = "https://m6-api.movie6.com"

// anonymousPath mints a short-lived access token. The request carries no
// fields at all; the reply carries a JWT that has to be found as text.
const anonymousPath = "/userpb.API/Anonymous"

// schedulePath lists one day's showtimes for one cinema.
const schedulePath = "/showpb.ShowAPI/ListByCinemaAndDate"

// grpcStatusRe and grpcMessageRe read the trailer frame, the only place an
// application error is reported.
var (
	grpcStatusRe  = regexp.MustCompile("(?i)(?:^|\\r?\\n)grpc-status:\\s*(\\d+)")
	grpcMessageRe = regexp.MustCompile("(?i)(?:^|\\r?\\n)grpc-message:\\s*([^\\r\\n]*)")
)

// grpcClient calls the gRPC-Web API with the headers the site sends.
type grpcClient struct {
	client *fetch.Client
}

// newGRPCClient builds a client. The API is reachable directly, so unlike the
// MCL circuit this one never needs the egress proxy.
func newGRPCClient() *grpcClient {
	return &grpcClient{client: fetch.New(fetch.WithTimeout(requestTimeout), fetch.WithRetries(1))}
}

// headers returns the request headers, plus the bearer token when there is one.
func (g *grpcClient) headers(token string) map[string]string {
	headers := map[string]string{
		"Content-Type": "application/grpc-web+proto",
		"X-Grpc-Web":   "1",
		"Type":         "application/grpc",
		"Language":     "zhHK",
		"Origin":       "https://hkmovie6.com",
		"Referer":      "https://hkmovie6.com/",
	}
	if token != "" {
		headers["Authorization"] = token
	}
	return headers
}

// call posts one framed protobuf request and returns the single message that
// comes back.
func (g *grpcClient) call(ctx context.Context, path string, payload []byte, token string) ([]byte, error) {
	body, err := g.client.Post(ctx, apiRoot+path, frame(payload), g.headers(token))
	if err != nil {
		return nil, fmt.Errorf("HK Movie 6 %s: %w", path, err)
	}
	messages, err := frames(body)
	if err != nil {
		return nil, fmt.Errorf("HK Movie 6 %s: %w", path, err)
	}
	if len(messages) != 1 {
		return nil, fmt.Errorf("HK Movie 6 %s returned %d protobuf messages", path, len(messages))
	}
	return messages[0], nil
}

// token mints an anonymous access token.
func (g *grpcClient) token(ctx context.Context) (string, error) {
	body, err := g.client.Post(ctx, apiRoot+anonymousPath, frame(nil), g.headers(""))
	if err != nil {
		return "", fmt.Errorf("HK Movie 6 anonymous access: %w", err)
	}
	messages, err := frames(body)
	if err != nil {
		return "", fmt.Errorf("HK Movie 6 anonymous access: %w", err)
	}
	for _, message := range messages {
		if match := tokenRe.Find(message); match != nil {
			return string(match), nil
		}
	}
	return "", fmt.Errorf("HK Movie 6 anonymous access returned no token")
}

// schedulePayload builds the request for one cinema on one day.
//
// Field 1 is the cinema uuid as a string, field 2 the date as epoch seconds.
func schedulePayload(cinemaID string, date int64) []byte {
	payload := protobuf.AppendString(nil, 1, cinemaID)
	return protobuf.AppendInt(payload, 2, uint64(date))
}

// frame wraps a protobuf message in the five byte gRPC-Web header.
func frame(payload []byte) []byte {
	header := make([]byte, 5)
	binary.BigEndian.PutUint32(header[1:], uint32(len(payload)))
	return append(header, payload...)
}

// frames splits a gRPC-Web body into its messages and enforces the status.
//
// A data frame has flag 0 and a trailer frame has flag 0x80; anything else is a
// protocol change worth failing on. The trailer is checked before returning
// because the API answers with HTTP 200 and a non-zero status for application
// errors, which is how an expired token shows up.
func frames(body []byte) ([][]byte, error) {
	var messages [][]byte
	status := -1
	for index := 0; index < len(body); {
		if index+5 > len(body) {
			return nil, fmt.Errorf("truncated gRPC-Web frame")
		}
		flags := body[index]
		length := int(binary.BigEndian.Uint32(body[index+1:]))
		index += 5
		if index+length > len(body) {
			return nil, fmt.Errorf("truncated gRPC-Web payload")
		}
		payload := body[index : index+length]
		index += length

		switch flags {
		case 0:
			messages = append(messages, payload)
		case 0x80:
			trailer := string(payload)
			if match := grpcStatusRe.FindStringSubmatch(trailer); match != nil {
				status = atoi(match[1])
			}
			if status != 0 {
				detail := "unknown gRPC error"
				if match := grpcMessageRe.FindStringSubmatch(trailer); match != nil && match[1] != "" {
					detail = match[1]
				}
				return nil, fmt.Errorf("gRPC status %d: %s", status, detail)
			}
		default:
			return nil, fmt.Errorf("unsupported gRPC-Web frame flags %d", flags)
		}
	}
	if status != 0 {
		return nil, fmt.Errorf("gRPC response has no successful status trailer")
	}
	return messages, nil
}

// atoi parses the small decimal number in a status trailer, returning -1 when
// the text is not a plain number so the caller treats it as unknown.
func atoi(value string) int {
	if value == "" {
		return -1
	}
	n := 0
	for _, r := range value {
		if r < '0' || r > '9' {
			return -1
		}
		n = n*10 + int(r-'0')
	}
	return n
}
