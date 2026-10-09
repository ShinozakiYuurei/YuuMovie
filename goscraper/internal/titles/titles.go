package titles

import (
	"regexp"
	"sort"
	"strings"

	"golang.org/x/text/unicode/norm"
)

var formatTokens = []string{
	"IMAX with Laser",
	"IMAX Laser",
	"IMAX",
	"MX4D",
	"4DX",
	"CGS",
	"LUXE",
	"Dolby Cinema",
	"Dolby Atmos",
	"Dolby",
	"Onyx",
	"ScreenX",
	"RealD",
	"D-BOX",
	"THX",
	"ATMOS",
	"CINITY",
	"Cinity",
	"全景聲",
	"全景声",
	"杜比",
	"巨幕",
	"動感影院",
	"Infinity Vision",
	"bcSunday",
	"bc30",
	"APAAA",
	"Diamond Hill",
	"開畫日特典首場",
	"开画日特典首场",
	"特典首場",
	"特典首场",
	"早鳥場",
	"早鳥",
	"早鸟场",
	"早鸟",
	"特典應援場",
	"特典場",
	"特典场",
	"特別放映",
	"特别放映",
	"特別上映",
	"特别上映",
	"優先場",
	"應援場",
	"中秋特典場",
	"椅套特典場",
	"椅套",
	"見面場",
	"Hi Bye Meet & Greet",
	"期間限定",
	"LIMITED",
	"導演剪輯版",
	"导演剪辑版",
	"4K修復版",
	"4K 修復版",
	"2K無字幕版",
	"35mm 菲林版",
	"35mm菲林版",
	"菲林版",
	"菲林",
	"35mm",
	"70mm",
	"16mm",
	"膠片版",
	"日語版",
	"英語版",
	"粵語版",
	"國語版",
	"原聲版",
	"加長版",
	"特別版",
	"Jap. Version",
	"Can. Version",
	"Cant. Version",
	"Eng. Version",
	"2D",
	"3D",
	"2D版",
	"3D版",
	"HKLGFF",
	"GFF",
	"KINO",
	"InDPanda",
	"anifest動画藝術祭",
	"New Wave",
	"Encore",
	"重映",
	"加碼重映",
	"限定重映",
	"Live Viewing",
	"謝票場",
	"谢票场",
}

var activityTags = map[string]bool{
	"Infinity Vision":     true,
	"bcSunday":            true,
	"bc30":                true,
	"APAAA":               true,
	"Diamond Hill":        true,
	"Hi Bye Meet & Greet": true,
	"期間限定":                true,
	"LIMITED":             true,
	"椅套":                  true,
	"謝票場":                 true,
	"谢票场":                 true,
	"特別放映":                true,
	"特别放映":                true,
	"特別上映":                true,
	"特别上映":                true,
	"2D":                  true,
	"3D":                  true,
	"2D版":                 true,
	"3D版":                 true,
	"HKLGFF":              true,
	"GFF":                 true,
	"KINO":                true,
	"InDPanda":            true,
	"anifest動画藝術祭":         true,
	"New Wave":            true,
}

var formatAlias = map[string]string{
	"全景声":             "全景聲",
	"IMAX with Laser": "IMAX",
	"IMAX Laser":      "IMAX",
	"Dolby Atmos":     "Dolby",
	"Dolby Cinema":    "Dolby",
	"CINITY":          "Cinity",
	"特典场":             "特典場",
	"開畫日特典首場":         "特典場",
	"开画日特典首场":         "特典場",
	"特典首場":           "特典場",
	"特典首场":           "特典場",
	"早鳥場":             "優先場",
	"早鳥":              "優先場",
	"早鸟场":             "優先場",
	"早鸟":              "優先場",
	"中秋特典場":           "特典場",
	"椅套特典場":           "特典場",
	"35mm 菲林版":        "菲林版",
	"35mm菲林版":         "菲林版",
	"菲林":              "菲林版",
	"35mm":            "菲林版",
	"70mm":            "菲林版",
	"16mm":            "菲林版",
	"膠片版":             "菲林版",
}

var sortedFormatTokens []string

func init() {
	sortedFormatTokens = make([]string, len(formatTokens))
	copy(sortedFormatTokens, formatTokens)
	sort.Slice(sortedFormatTokens, func(i, j int) bool {
		return len(sortedFormatTokens[i]) > len(sortedFormatTokens[j])
	})
}

func normalizeText(s string) string {
	s = norm.NFKC.String(s)
	s = norm.NFD.String(s)
	var b strings.Builder
	for _, r := range s {
		if r < 0x0300 || r > 0x036F {
			b.WriteRune(r)
		}
	}
	return b.String()
}

var (
	reYearSeason = regexp.MustCompile(`\b(?:19|20)\d{2}\s*[-–—]\s*(?:\d{2}|\d{4})\b`)
	reYearFour   = regexp.MustCompile(`\b(?:19|20)\d{2}\b`)
)

func stripYear(s string) string {
	s = reYearSeason.ReplaceAllString(s, " ")
	s = reYearFour.ReplaceAllString(s, " ")
	return s
}

var (
	reArticleInBrackets = regexp.MustCompile(`([（(\[【]\s*)(?:The|the)\s+`)
	reDialectParen      = regexp.MustCompile(`[（(\[【]\s*[日粵國英韓台美陸法](?:語|語版|片)?\s*[)）\]】]`)
	reChiSpParen        = regexp.MustCompile(`(?i)[（(\[【]\s*chi\s*[)）\]】]\s*sp\b`)
	rePreviewParen      = regexp.MustCompile(`(?i)[（(\[【]\s*(?:preview|chi|sp|meet\s*&\s*greet|優先|优先)\s*[)）\]】]`)
	reTailPriority      = regexp.MustCompile(`\s+(?:優先|优先)\s*$`)
	reRomanSeqParen     = regexp.MustCompile(`([（(\[【]\s*(?:[IVX]{1,4}|\d{1,2})\s*[)）\]】])\s+`)
	reSpecialScreening  = regexp.MustCompile(`[（(\[【]\s*(?:[「『][^」』]{1,40}[」』]\s*)?(?:特別放映|特别放映|特別上映|特别上映)\s*[）)\]】]`)
	reScreeningPrefix   = regexp.MustCompile(`(^|[\s【】《》（）()「」\[\]])([\x{4e00}-\x{9fff}]{0,6}(?:(?:開畫日|开画日)?特典首場|(?:開畫日|开画日)?特典首场|早鳥場?|早鸟场?|(?:特典|優先|應援|見面|嘉賓|首映|紀念|神秘|節日|場次)場))`)
	reAnnivRestoration  = regexp.MustCompile(`(^|[^\d])(\d{1,3}\s*(?:周年|週年)\s*(?:4K\s*)?修[復复]版)($|[\s（(\[【])`)
	reBrackets          = regexp.MustCompile(`[【】《》（）()「」\[\]]`)
)

func preprocessTitle(raw string) string {
	s := normalizeText(raw)
	s = reArticleInBrackets.ReplaceAllString(s, "${1}")
	s = reDialectParen.ReplaceAllString(s, " ")
	s = reChiSpParen.ReplaceAllString(s, " ")
	s = rePreviewParen.ReplaceAllString(s, " ")
	s = reTailPriority.ReplaceAllString(s, " ")
	s = reRomanSeqParen.ReplaceAllString(s, " ")
	s = reSpecialScreening.ReplaceAllString(s, " ")
	s = reScreeningPrefix.ReplaceAllString(s, "${1} ")
	s = reAnnivRestoration.ReplaceAllString(s, "${1} ${3}")
	s = reBrackets.ReplaceAllString(s, " ")
	return stripYear(s)
}

func isAsciiToken(token string) bool {
	for i := 0; i < len(token); i++ {
		if token[i] > 127 {
			return false
		}
	}
	return true
}

func buildTokenRegex(token string) *regexp.Regexp {
	esc := regexp.QuoteMeta(token)
	if isAsciiToken(token) {
		return regexp.MustCompile(`(?i)(^|[^A-Za-z0-9])` + esc + `([^A-Za-z0-9]|$)`)
	}
	if token == "特別放映" || token == "特别放映" || token == "特別上映" || token == "特别上映" {
		return regexp.MustCompile(`(^|[\s（(\[【])` + esc + `([\s）)\]】，,。、]|$)`)
	}
	return regexp.MustCompile(esc)
}

var (
	reCrossWord    = regexp.MustCompile(`\s+[xX×]\s+`)
	rePunctuation  = regexp.MustCompile(`[：:·・—–\-_,，。、!！?？'"“”]`)
	reMultiSpace   = regexp.MustCompile(`\s+`)
	reSingleLetter = regexp.MustCompile(`^[a-z]\s+|\s+[a-z]$`)
	reBanTail      = regexp.MustCompile(`\s+版$`)
)

var exactTitleAliases = map[string]string{
	"怎麽可能我家的祖先是你家的鬼":                                    "怎麼可能我家的祖先是你家的鬼",
	"chiikawa the movie the secret of the mermaid isla": "chiikawa the movie the secret of the mermaid island",
}

// NormalizeTitle normalises a title for grouping and deduplication.
func NormalizeTitle(name string) string {
	if strings.TrimSpace(name) == "" {
		return ""
	}

	s := preprocessTitle(name)
	var prev string
	guard := 0
	for guard < 10 {
		prev = s
		for _, token := range sortedFormatTokens {
			re := buildTokenRegex(token)
			if isAsciiToken(token) {
				s = re.ReplaceAllString(s, "${1} ${2}")
			} else {
				if token == "特別放映" || token == "特别放映" || token == "特別上映" || token == "特别上映" {
					s = re.ReplaceAllString(s, "${1} ${2}")
				} else {
					s = re.ReplaceAllString(s, " ")
				}
			}
		}
		if s == prev {
			break
		}
		guard++
	}

	s = reCrossWord.ReplaceAllString(s, " ")
	s = rePunctuation.ReplaceAllString(s, " ")
	s = reMultiSpace.ReplaceAllString(s, " ")
	s = strings.ToLower(strings.TrimSpace(s))

	s = reSingleLetter.ReplaceAllString(s, "")
	s = reBanTail.ReplaceAllString(s, "")
	s = strings.TrimSpace(s)

	if alias, ok := exactTitleAliases[s]; ok {
		return alias
	}
	return s
}

// StripFormats strips format tokens while preserving display casing.
func StripFormats(name string) string {
	if strings.TrimSpace(name) == "" {
		return ""
	}
	s := preprocessTitle(name)
	var prev string
	guard := 0
	for guard < 10 {
		prev = s
		for _, token := range sortedFormatTokens {
			re := buildTokenRegex(token)
			if isAsciiToken(token) {
				s = re.ReplaceAllString(s, "${1} ${2}")
			} else {
				if token == "特別放映" || token == "特别放映" || token == "特別上映" || token == "特别上映" {
					s = re.ReplaceAllString(s, "${1} ${2}")
				} else {
					s = re.ReplaceAllString(s, " ")
				}
			}
		}
		if s == prev {
			break
		}
		guard++
	}

	s = reCrossWord.ReplaceAllString(s, " ")
	s = regexp.MustCompile(`\s*[：:]\s*$`).ReplaceAllString(s, "")
	s = reBanTail.ReplaceAllString(s, "")
	s = reMultiSpace.ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}

func dedupeOverlaps(tokens []string) []string {
	lower := make([]string, len(tokens))
	for i, t := range tokens {
		lower[i] = strings.ToLower(t)
	}
	var out []string
	for i, a := range tokens {
		sub := false
		for j := range tokens {
			if i != j && strings.Contains(lower[j], lower[i]) && lower[j] != lower[i] {
				sub = true
				break
			}
		}
		if !sub {
			out = append(out, a)
		}
	}
	return out
}

// ExtractFormats extracts format labels from a title.
func ExtractFormats(name string) []string {
	if strings.TrimSpace(name) == "" {
		return nil
	}
	foundMap := map[string]bool{}

	for _, token := range sortedFormatTokens {
		if activityTags[token] {
			continue
		}
		re := buildTokenRegex(token)
		if re.MatchString(name) {
			alias := formatAlias[token]
			if alias == "" {
				alias = token
			}
			foundMap[alias] = true
		}
	}

	rawNorm := normalizeText(name)
	matches := reAnnivRestoration.FindAllStringSubmatch(rawNorm, -1)
	for _, m := range matches {
		if len(m) > 2 {
			clean := regexp.MustCompile(`\s+`).ReplaceAllString(m[2], "")
			foundMap[clean] = true
		}
	}

	var list []string
	for k := range foundMap {
		list = append(list, k)
	}
	return dedupeOverlaps(list)
}

var languageTokens = map[string]string{
	"日語版": "日語",
	"英語版": "英語",
	"粵語版": "粵語",
	"國語版": "國語",
	"原聲版": "原聲",
}

var formatLabelMap = map[string]string{
	"IMAX":    "IMAX",
	"4DX":     "4DX",
	"MX4D":    "MX4D",
	"LUXE":    "LUXE",
	"Dolby":   "杜比全景聲",
	"全景聲":     "全景聲",
	"CGS":     "CGS",
	"RealD":   "RealD 3D",
	"THX":     "THX",
	"Onyx":    "Onyx LED",
	"ScreenX": "ScreenX",
	"D-BOX":   "D-BOX",
	"特典場":     "特典場",
	"優先場":     "優先場",
	"應援場":     "應援場",
	"4K修復版":   "4K 修復版",
	"菲林版":     "35mm 菲林版",
}

// FormatLabel maps a format token to its display label.
var nonArtTokens = map[string]bool{
	"Infinity Vision":     true,
	"bcSunday":            true,
	"bc30":                true,
	"APAAA":               true,
	"Diamond Hill":        true,
	"Hi Bye Meet & Greet": true,
	"期間限定":                true,
	"LIMITED":             true,
	"椅套":                  true,
	"謝票場":                 true,
	"谢票场":                 true,
	"特別放映":                true,
	"特别放映":                true,
	"特別上映":                true,
	"特别上映":                true,
	"2D":                  true,
	"3D":                  true,
	"2D版":                 true,
	"3D版":                 true,
	"HKLGFF":              true,
	"GFF":                 true,
	"KINO":                true,
	"InDPanda":            true,
	"anifest動画藝術祭":         true,
	"New Wave":            true,
	"Encore":              true,
	"重映":                  true,
	"加碼重映":                true,
	"限定重映":                true,
	"Live Viewing":        true,
	"特典應援場":               true,
	"特典場":                 true,
	"特典场":                 true,
	"優先場":                 true,
	"應援場":                 true,
	"中秋特典場":               true,
	"椅套特典場":               true,
	"見面場":                 true,
}

var formatOrder = []string{
	"IMAX", "Dolby", "Cinity", "LUXE", "MX4D", "4DX", "ScreenX", "Onyx", "D-BOX", "CGS",
	"RealD", "THX", "ATMOS", "全景聲", "杜比", "巨幕", "動感影院",
	"特典場", "優先場", "應援場", "中秋特典場", "見面場",
	"導演剪輯版", "4K修復版", "菲林版",
	"日語版", "英語版", "粵語版", "國語版", "原聲版", "加長版", "特別版",
}

func sortFormats(formats []string) []string {
	orderIndex := func(f string) int {
		for i, o := range formatOrder {
			if o == f {
				return i
			}
		}
		return 999
	}
	out := make([]string, len(formats))
	copy(out, formats)
	sort.Slice(out, func(i, j int) bool {
		return orderIndex(out[i]) < orderIndex(out[j])
	})
	return out
}

func FormatLabel(fmt string) string {
	if l, ok := formatLabelMap[fmt]; ok {
		return l
	}
	return fmt
}

// ProjectionFormats filters formats to only those describing projection.
func ProjectionFormats(formats []string) []string {
	var out []string
	for _, f := range formats {
		if !nonArtTokens[f] && languageTokens[f] == "" {
			out = append(out, f)
		}
	}
	return sortFormats(out)
}

// VersionLanguage returns language label from formats, or empty string.
func VersionLanguage(formats []string) string {
	for _, f := range formats {
		if l, ok := languageTokens[f]; ok {
			return l
		}
	}
	return ""
}

// FormatVersionText produces the format·language string for screenings.
func FormatVersionText(formats []string, filmLanguage *string) string {
	var projLabels []string
	for _, f := range ProjectionFormats(formats) {
		projLabels = append(projLabels, FormatLabel(f))
	}

	fromMarker := VersionLanguage(formats)
	lang := fromMarker
	if lang == "" && filmLanguage != nil {
		lang = *filmLanguage
	}

	if len(projLabels) > 0 {
		base := strings.Join(projLabels, " + ")
		if lang != "" {
			return base + "·" + lang
		}
		return base
	}

	if fromMarker != "" {
		return fromMarker + "版"
	}
	if lang != "" {
		return "原版·" + lang
	}
	return "原版"
}

// ----------------- English Title Cleaning -----------------

var enTitleNoiseBrackets = []string{
	"Preview", "SP", "Meet & Greet",
	"Opening Day Special Screening", "Early Bird Screening", "VIP Screening",
	"Seat Cover Special Screening", "Special Screening", "Hi Bye Meet & Greet",
	"Japanese Version", "Cantonese Version", "English Version", "Mandarin Version", "Korean Version",
	"Jap. Version", "Can. Version", "Cant. Version", "Eng. Version",
	"Jap Version", "Can Version", "Cant Version", "Eng Version",
	"Jap", "Can", "Cant", "Eng", "Chi", "Mand",
	"IMAX with Laser", "IMAX Laser", "IMAX", "MX4D", "4DX", "CGS", "LUXE",
	"Dolby Atmos", "Dolby Cinema", "Dolby", "Atmos", "ScreenX", "Onyx", "D-BOX",
	"RealD", "THX", "CINITY", "Cinity",
	"2D", "3D", "35mm Film", "35mm", "70mm", "16mm",
	"35th Anniversary", "4K digital restored version",
	"4K Restoration", "4K Restored Version", "Restoration", "Restored Version",
	"LIMITED", "Limited", "Live Viewing",
	"Infinity Vision", "bcSunday", "bc30", "APAAA", "Diamond Hill",
	"KINO", "GFF", "HKLGFF", "InDPanda", "anifest", "New Wave",
	"NT Live", "The Met", "The Royal Ballet", "Paris Opera Ballet",
}

var enTitleNoiseBare = []string{
	"Opening Day Special Screening", "Early Bird Screening", "VIP Screening",
	"Seat Cover Special Screening", "Special Screening", "Hi Bye Meet & Greet",
	"Japanese Version", "Cantonese Version", "English Version", "Mandarin Version", "Korean Version",
	"Jap. Version", "Can. Version", "Cant. Version", "Eng. Version",
	"IMAX with Laser", "IMAX Laser", "IMAX", "MX4D", "4DX", "CGS", "LUXE",
	"Dolby Atmos", "Dolby Cinema", "ScreenX", "D-BOX", "RealD", "CINITY", "Cinity",
	"35mm Film", "35mm", "70mm", "16mm",
	"4K Restoration", "4K Restored Version", "Live Viewing",
	"Infinity Vision",
}

var enNoiseBracketSorted []string
var enNoiseBareSorted []string
var enNoiseBracketSet map[string]bool

func init() {
	enNoiseBracketSorted = make([]string, len(enTitleNoiseBrackets))
	copy(enNoiseBracketSorted, enTitleNoiseBrackets)
	sort.Slice(enNoiseBracketSorted, func(i, j int) bool {
		return len(enNoiseBracketSorted[i]) > len(enNoiseBracketSorted[j])
	})

	enNoiseBareSorted = make([]string, len(enTitleNoiseBare))
	copy(enNoiseBareSorted, enTitleNoiseBare)
	sort.Slice(enNoiseBareSorted, func(i, j int) bool {
		return len(enNoiseBareSorted[i]) > len(enNoiseBareSorted[j])
	})

	enNoiseBracketSet = make(map[string]bool, len(enTitleNoiseBrackets))
	for _, n := range enTitleNoiseBrackets {
		enNoiseBracketSet[strings.ToLower(n)] = true
	}
}

var (
	reSeasonOrYear = regexp.MustCompile(`^\d{4}(\s*[-–—]\s*(\d{2}|\d{4}))?$`)
	reRomanOrNum   = regexp.MustCompile(`^[IVX]{1,4}$|^\d{1,2}$`)
)

func isEnglishNoiseToken(inner string) bool {
	t := strings.TrimSpace(inner)
	t = strings.TrimRight(t, ".·")
	t = strings.TrimSpace(t)
	if t == "" {
		return true
	}
	if enNoiseBracketSet[strings.ToLower(t)] {
		return true
	}
	if reSeasonOrYear.MatchString(t) {
		return true
	}
	if reRomanOrNum.MatchString(t) {
		return true
	}
	for _, n := range enNoiseBracketSorted {
		re := regexp.MustCompile(`(?i)^` + regexp.QuoteMeta(n) + `\b`)
		if re.MatchString(t) {
			return true
		}
	}
	return false
}

var (
	reEnParenBlock = regexp.MustCompile(`[（(\[【]\s*([^)^）\]】]*)\s*[)）\]】]`)
	reColonSpacing = regexp.MustCompile(`\s*:\s*`)
	reDashTail     = regexp.MustCompile(`\s+[-–—]+$`)
	reDashHead     = regexp.MustCompile(`^[-–—]+\s+`)
	reEdgeNoise    = regexp.MustCompile(`^[\s:·,;]+|[\s:·,;]+$`)
)

// StripEnglishTitleNoise strips format, event, and language noise from English titles.
func StripEnglishTitleNoise(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	s = reChiSpParen.ReplaceAllString(s, " ")

	for loop := 0; loop < 6; loop++ {
		before := s
		// 1) paren noise
		s = reEnParenBlock.ReplaceAllStringFunc(s, func(match string) string {
			sub := reEnParenBlock.FindStringSubmatch(match)
			if len(sub) > 1 && isEnglishNoiseToken(sub[1]) {
				return " "
			}
			return match
		})

		// 2) bare noise
		for _, n := range enNoiseBareSorted {
			re := regexp.MustCompile(`(?i)(^|\s)` + regexp.QuoteMeta(n) + `(\s|$)`)
			s = re.ReplaceAllString(s, "${1} ${2}")
		}

		s = reMultiSpace.ReplaceAllString(s, " ")
		s = strings.TrimSpace(s)
		if s == before {
			break
		}
	}

	s = strings.ReplaceAll(s, "：", ":")
	s = strings.ReplaceAll(s, "，", ",")
	s = reColonSpacing.ReplaceAllString(s, ": ")
	s = reDashTail.ReplaceAllString(s, "")
	s = reDashHead.ReplaceAllString(s, "")
	s = reEdgeNoise.ReplaceAllString(s, "")
	s = reMultiSpace.ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}
