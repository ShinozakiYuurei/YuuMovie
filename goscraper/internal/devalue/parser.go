package devalue

import (
	"fmt"
	"strconv"
)

// parser is a recursive-descent reader for the closed payload grammar.
//
// It deliberately has no support for operators, calls or computed keys: none
// appear in a Nuxt payload, and accepting them would mean shipping an
// expression evaluator to read a data structure. Anything unexpected is an
// error, so a site change that adds one fails loudly rather than being silently
// misread.
type parser struct {
	src   string
	pos   int
	scope map[string]any
}

func (p *parser) skipSpace() {
	for p.pos < len(p.src) {
		switch p.src[p.pos] {
		case ' ', '\t', '\n', '\r':
			p.pos++
		default:
			return
		}
	}
}

// argument reads one value in the trailing argument list, where identifiers are
// literals rather than references.
func (p *parser) argument() (any, error) {
	p.skipSpace()
	if p.pos >= len(p.src) {
		return nil, fmt.Errorf("unexpected end of argument list")
	}
	c := p.src[p.pos]
	if c == '"' {
		return p.readString()
	}
	if c == '{' || c == '[' {
		return p.value("")
	}
	if c == '-' || (c >= '0' && c <= '9') {
		return p.readNumber()
	}
	word := p.readIdentifier()
	switch word {
	case "true":
		return true, nil
	case "false":
		return false, nil
	case "null", "undefined":
		return nil, nil
	}
	return nil, fmt.Errorf("unexpected argument %q", word)
}

// value reads one value in the return expression, resolving identifiers through
// the scope.
func (p *parser) value(where string) (any, error) {
	p.skipSpace()
	if p.pos >= len(p.src) {
		return nil, fmt.Errorf("%sunexpected end of expression", at(where))
	}

	c := p.src[p.pos]
	switch {
	case c == '"':
		return p.readString()
	case c == '{':
		return p.readObject(where)
	case c == '[':
		return p.readArray(where)
	case c == '-' || c == '+' || (c >= '0' && c <= '9'):
		return p.readNumber()
	}

	word := p.readIdentifier()
	if word == "" {
		return nil, fmt.Errorf("%sunexpected character %q", at(where), string(c))
	}
	if p.scope == nil {
		// Grammar pass: a declared parameter is the only legal identifier, plus
		// the bare literals. They are accepted because devalue emits them inline
		// wherever a value is expected, so treating them as identifiers here is
		// only about the check, not about how they are read.
		switch word {
		case "true":
			return true, nil
		case "false":
			return false, nil
		case "null", "undefined":
			return nil, nil
		}
		if parameterIDs[word] {
			return nil, nil
		}
		return nil, fmt.Errorf("%sunresolved identifier %q", at(where), word)
	}
	if v, ok := p.scope[word]; ok {
		return v, nil
	}
	switch word {
	case "true":
		return true, nil
	case "false":
		return false, nil
	case "null", "undefined":
		return nil, nil
	}
	return nil, fmt.Errorf("%sunresolved identifier %q", at(where), word)
}

func at(where string) string {
	if where == "" {
		return ""
	}
	return where + ": "
}

// parameterIDs holds the declared parameter names during the grammar pass.
var parameterIDs = map[string]bool{}

func (p *parser) readObject(where string) (any, error) {
	p.pos++
	out := map[string]any{}
	p.skipSpace()
	if p.pos < len(p.src) && p.src[p.pos] == '}' {
		p.pos++
		return out, nil
	}
	for {
		p.skipSpace()
		key, err := p.readKey()
		if err != nil {
			return nil, err
		}
		p.skipSpace()
		if p.pos >= len(p.src) || p.src[p.pos] != ':' {
			return nil, fmt.Errorf("%sexpected : after key %q", at(where), key)
		}
		p.pos++
		v, err := p.value(where + "." + key)
		if err != nil {
			return nil, err
		}
		out[key] = v
		p.skipSpace()
		if p.pos < len(p.src) && p.src[p.pos] == ',' {
			p.pos++
			p.skipSpace()
			if p.pos < len(p.src) && p.src[p.pos] == '}' {
				p.pos++
				return out, nil
			}
			continue
		}
		if p.pos < len(p.src) && p.src[p.pos] == '}' {
			p.pos++
			return out, nil
		}
		return nil, fmt.Errorf("%sexpected , or } after %q", at(where), key)
	}
}

func (p *parser) readArray(where string) (any, error) {
	p.pos++
	out := []any{}
	p.skipSpace()
	if p.pos < len(p.src) && p.src[p.pos] == ']' {
		p.pos++
		return out, nil
	}
	for {
		v, err := p.value(where + "[]")
		if err != nil {
			return nil, err
		}
		out = append(out, v)
		p.skipSpace()
		if p.pos < len(p.src) && p.src[p.pos] == ',' {
			p.pos++
			p.skipSpace()
			if p.pos < len(p.src) && p.src[p.pos] == ']' {
				p.pos++
				return out, nil
			}
			continue
		}
		if p.pos < len(p.src) && p.src[p.pos] == ']' {
			p.pos++
			return out, nil
		}
		return nil, fmt.Errorf("%sexpected , or ]", at(where))
	}
}

// readKey reads an object key, a bare identifier in this payload.
func (p *parser) readKey() (string, error) {
	if p.pos >= len(p.src) {
		return "", fmt.Errorf("unexpected end of object")
	}
	if p.src[p.pos] == '"' {
		v, err := p.readString()
		if err != nil {
			return "", err
		}
		return v.(string), nil
	}
	key := p.readIdentifier()
	if key == "" {
		return "", fmt.Errorf("expected an object key near %q", p.snippet())
	}
	return key, nil
}

func (p *parser) snippet() string {
	end := p.pos + 24
	if end > len(p.src) {
		end = len(p.src)
	}
	return p.src[p.pos:end]
}

func (p *parser) readIdentifier() string {
	start := p.pos
	for p.pos < len(p.src) {
		c := p.src[p.pos]
		if c == '_' || c == '$' || (c >= 'a' && c <= 'z') ||
			(c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') {
			p.pos++
			continue
		}
		break
	}
	return p.src[start:p.pos]
}

func (p *parser) readNumber() (any, error) {
	start := p.pos
	if p.pos < len(p.src) && (p.src[p.pos] == '-' || p.src[p.pos] == '+') {
		p.pos++
	}
	if hasPrefixAt(p.src, p.pos, "-Infinity") {
		p.pos += len("-Infinity")
		return nil, nil
	}
	for p.pos < len(p.src) {
		c := p.src[p.pos]
		if (c >= '0' && c <= '9') || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-' {
			p.pos++
			continue
		}
		break
	}
	text := p.src[start:p.pos]
	n, err := strconv.ParseFloat(text, 64)
	if err != nil {
		return nil, fmt.Errorf("bad number %q", text)
	}
	return n, nil
}

func hasPrefixAt(s string, pos int, prefix string) bool {
	return pos+len(prefix) <= len(s) && s[pos:pos+len(prefix)] == prefix
}

func (p *parser) readString() (any, error) {
	p.pos++
	start := p.pos
	escaped := false
	for p.pos < len(p.src) {
		c := p.src[p.pos]
		if escaped {
			escaped = false
			p.pos++
			continue
		}
		if c == '\\' {
			escaped = true
			p.pos++
			continue
		}
		if c == '"' {
			raw := p.src[start:p.pos]
			p.pos++
			return decodeJS(raw)
		}
		p.pos++
	}
	return nil, fmt.Errorf("unterminated string literal")
}

// decodeJS turns a quoted body into text.
//
// The payload writes forward slashes as \u002F and quotes as \", so the \uXXXX
// form has to be handled alongside the plain escapes.
func decodeJS(raw string) (string, error) {
	var b []byte
	for i := 0; i < len(raw); i++ {
		if raw[i] != '\\' {
			b = append(b, raw[i])
			continue
		}
		i++
		if i >= len(raw) {
			return "", fmt.Errorf("trailing backslash in string literal")
		}
		switch raw[i] {
		case 'n':
			b = append(b, '\n')
		case 't':
			b = append(b, '\t')
		case 'r':
			b = append(b, '\r')
		case 'b':
			b = append(b, '\b')
		case 'f':
			b = append(b, '\f')
		case 'u':
			if i+4 >= len(raw) {
				return "", fmt.Errorf("truncated unicode escape")
			}
			n, err := strconv.ParseUint(raw[i+1:i+5], 16, 32)
			if err != nil {
				return "", fmt.Errorf("bad unicode escape %q", raw[i:i+5])
			}
			b = append(b, []byte(string(rune(n)))...)
			i += 4
		default:
			b = append(b, raw[i])
		}
	}
	return string(b), nil
}
