package devalue

import (
	"fmt"
	"strings"
)

// Eval parses a payload assignment (with or without the window.__NUXT__=
// prefix) and returns the resulting value.
func Eval(script string) (any, error) {
	body, err := payloadBody(script)
	if err != nil {
		return nil, err
	}
	return evalBody(body)
}

// payloadBody strips the assignment and the trailing semicolon.
func payloadBody(script string) (string, error) {
	const prefix = "window.__NUXT__="
	i := strings.Index(script, prefix)
	if i < 0 {
		return "", fmt.Errorf("no %s assignment found", prefix)
	}
	return strings.TrimRight(strings.TrimSpace(script[i+len(prefix):]), ";"), nil
}

// endOfExpression finds where the top-level expression in the return clause
// stops, honouring nesting and string literals.
func endOfExpression(body string, start int) (int, error) {
	depth := 0
	inString := false
	for i := start; i < len(body); i++ {
		switch c := body[i]; {
		case inString:
			if c == '\\' {
				i++
				continue
			}
			if c == '"' {
				inString = false
			}
		case c == '"':
			inString = true
		case c == '(' || c == '{' || c == '[':
			depth++
		case c == ')' || c == '}' || c == ']':
			if depth == 0 {
				return i, nil
			}
			depth--
		}
	}
	return 0, fmt.Errorf("unterminated return expression")
}

// parseArguments splits the trailing argument list into values.
func parseArguments(src string) ([]any, error) {
	p := &parser{src: src}
	var out []any
	p.skipSpace()
	for p.pos < len(src) && src[p.pos] != ')' {
		v, err := p.argument()
		if err != nil {
			return nil, err
		}
		out = append(out, v)
		p.skipSpace()
		if p.pos < len(src) && src[p.pos] == ',' {
			p.pos++
			continue
		}
		break
	}
	return out, nil
}
