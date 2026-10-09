package devalue

import (
	"fmt"
)

// evalBody runs the self-invoking function and returns what it returns.
func evalBody(body string) (any, error) {
	open := indexOf(body, "(function(")
	if open < 0 {
		return nil, fmt.Errorf("payload is not a function expression")
	}
	paramsStart := open + len("(function(")
	arrow := indexOf(body[paramsStart:], "){return")
	if arrow < 0 {
		return nil, fmt.Errorf("payload has no ){return")
	}
	arrow += paramsStart
	params := splitParams(body[paramsStart:arrow])

	returnStart := arrow + len("){return")
	end, err := endOfExpression(body, returnStart)
	if err != nil {
		return nil, err
	}

	// The argument list follows the closing brace of the function body.
	argsStart := end + 1
	if argsStart >= len(body) || body[argsStart] != '(' {
		return nil, fmt.Errorf("payload has no argument list")
	}
	args, err := parseArguments(body[argsStart+1:])
	if err != nil {
		return nil, err
	}
	if len(args) != len(params) {
		return nil, fmt.Errorf("payload passes %d arguments for %d parameters", len(args), len(params))
	}

	// First pass: no scope, so this only checks that the expression stays inside
	// the closed grammar this package implements. An identifier is accepted when
	// it names a declared parameter, which is the only use the payload makes.
	for _, name := range params {
		parameterIDs[name] = true
	}
	check := &parser{src: body, pos: returnStart}
	if _, err := check.value(""); err != nil {
		return nil, err
	}
	check.skipSpace()
	if check.pos != end {
		return nil, fmt.Errorf("root expression ends at %d, expected %d", check.pos, end)
	}

	// Second pass: resolve the references against the arguments.
	scope := make(map[string]any, len(params))
	for i, name := range params {
		scope[name] = args[i]
	}
	p := &parser{src: body, pos: returnStart, scope: scope}
	out, err := p.value("")
	if err != nil {
		return nil, err
	}
	p.skipSpace()
	if p.pos != end {
		return nil, fmt.Errorf("root expression ends at %d, expected %d", p.pos, end)
	}
	return out, nil
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func splitParams(s string) []string {
	var out []string
	start := 0
	for i := 0; i <= len(s); i++ {
		if i == len(s) || s[i] == ',' {
			out = append(out, s[start:i])
			start = i + 1
		}
	}
	return out
}
