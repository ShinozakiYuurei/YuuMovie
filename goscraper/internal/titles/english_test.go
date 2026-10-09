package titles

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

type EnglishCase struct {
	Input string
	Want  string
	Why   string
}

var englishCases = []EnglishCase{
	{"IMAX The Odyssey", "The Odyssey", "百老汇把规格写在裸词前缀"},
	{"4DX Avengers: Endgame Encore Infinity Vision", "Avengers: Endgame Encore", "规格+活动标签同时出现，Encore保留"},
	{"CGS Avengers: Endgame Encore Infinity Vision", "Avengers: Endgame Encore", "CGS 是规格"},
	{"Avengers: Endgame Encore (Atmos)", "Avengers: Endgame Encore", "全景声在英文侧写 (Atmos)"},
	{"(2D) Avengers: Endgame Encore", "Avengers: Endgame Encore", "英皇把 2D 写在括号前缀"},
	{"Avengers: Endgame Encore (2D Version)", "Avengers: Endgame Encore", "2D Version 写法"},
	{"35mm Film The Odyssey", "The Odyssey", "菲林版的英文写法"},
	{"Oasis (35mm)", "Oasis", "括号里的规格缩写"},
	{"Paw Patrol :The Dino Movie (English Version)", "Paw Patrol: The Dino Movie", "语言版本要剥，冒号粘连归一"},
	{"(Cant. Version) PAW PATROL: THE DINO MOVIE", "PAW PATROL: THE DINO MOVIE", "英皇的缩写写法"},
	{"Chiikawa the Movie: The Secret of Mermaid Island (Jap)", "Chiikawa the Movie: The Secret of Mermaid Island", "Jap 对应日"},
	{"(Jap. Version) CHIIKAWA THE MOVIE: THE SECRET OF THE MERMAID ISLAND", "CHIIKAWA THE MOVIE: THE SECRET OF THE MERMAID ISLAND", "Jap. Version 写法"},
	{"Good Trip Special Screening", "Good Trip", "特典场的裸词英文写法"},
	{"(Special Screening) Good Trip", "Good Trip", "括号前缀特典场"},
	{"(Seat Cover Special Screening) (Jap. Version) CHIIKAWA THE MOVIE: THE SECRET OF THE MERMAID ISLAND", "CHIIKAWA THE MOVIE: THE SECRET OF THE MERMAID ISLAND", "椅套特典场+日语版两个括号都要剥"},
	{"Taxi Driver (Special Screening)", "Taxi Driver", "后缀写法的特典场"},
	{"Trial of Hein (KINO)", "Trial of Hein", "影展名 KINO"},
	{"Gendernauts: A Journey Through Shifting Identities (HKLGFF 2026)", "Gendernauts: A Journey Through Shifting Identities", "影展名+年份整块剥掉"},
	{"The Fifth Step (NT Live 2026-27)", "The Fifth Step", "NT Live + 演出季区间"},
	{"SWAN LAKE (The Royal Ballet 2026 – 2027)", "SWAN LAKE", "带空格的连字符演出季"},
	{"Bio-Zombie (bc30 x APAAA)", "Bio-Zombie", "活动标签组合写法"},
	{"Hidden Heroes (bc30 x APAAA)", "Hidden Heroes", "同上"},
	{"(IV) Avengers: Endgame Encore", "Avengers: Endgame Encore", "罗马序号"},
	{"GIANT – The Play (2026)", "GIANT – The Play", "纯年份括号"},
	{"Evangelion: Death (True)\u00b2 & Rebirth", "Evangelion: Death (True)\u00b2 & Rebirth", "(True) 是片名一部分，必须原样保留"},
	{"Evangelion: 3.33 You Can (Not) Redo", "Evangelion: 3.33 You Can (Not) Redo", "(Not) 是片名一部分，必须原样保留"},
	{"Evangelion: 1.11 You Are (Not) Alone", "Evangelion: 1.11 You Are (Not) Alone", "同上"},
	{"Puella Magi Madoka Magica The Movie -Rebellion-", "Puella Magi Madoka Magica The Movie -Rebellion-", "首尾连字符不能被误当残留收掉"},
	{"Can You Ever Forgive Me?", "Can You Ever Forgive Me?", "开头的 Can 是英文单词而非粤语版"},
	{"Once Upon A Time In Middle East", "Once Upon A Time In Middle East", "普通片名"},
	{"Avengers: Endgame Encore", "Avengers: Endgame Encore", "Encore 必须保留"},
	{"V", "V", "单字母片名"},
}

func TestEnglishTitleCleaningCases(t *testing.T) {
	for _, c := range englishCases {
		got := StripEnglishTitleNoise(c.Input)
		if got != c.Want {
			t.Errorf("%s: got %q, want %q (reason: %s)", c.Input, got, c.Want, c.Why)
		}
	}
}

var reStillDirty = regexp.MustCompile(`(?i)Version|Screening|Restor|Atmos|IMAX|4DX|MX4D|CGS|LUXE|KINO|HKLGFF|GFF|InDPanda|NT Live|bcSunday|bc30|anifest|The Met|Royal Ballet`)
var reCJK = regexp.MustCompile(`[\x{4e00}-\x{9fff}\x{3040}-\x{30ff}\x{ac00}-\x{d7af}]`)

func TestEnglishTitleGroupAudit(t *testing.T) {
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "../../../data"
	}
	path := filepath.Join(dataDir, "movies.json")
	b, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("data/movies.json not found, skipping real data english audit")
		return
	}

	type movieItem struct {
		NameZh string `json:"nameZh"`
		NameEn string `json:"nameEn"`
	}
	var movies []movieItem
	if err := json.Unmarshal(b, &movies); err != nil {
		t.Fatalf("failed to parse movies.json: %v", err)
	}

	groups := map[string][]string{}
	for _, m := range movies {
		k := NormalizeTitle(m.NameZh)
		if m.NameEn != "" && !reCJK.MatchString(m.NameEn) {
			groups[k] = append(groups[k], m.NameEn)
		}
	}

	checked := 0
	for k, rawList := range groups {
		var best string
		for _, raw := range rawList {
			c := StripEnglishTitleNoise(raw)
			if c == "" {
				continue
			}
			if best == "" || (!reStillDirty.MatchString(c) && reStillDirty.MatchString(best)) {
				best = c
			}
		}
		if best != "" {
			checked++
			if reStillDirty.MatchString(best) {
				t.Errorf("Group %s best english title still dirty: %q", k, best)
			}
		}
	}
	t.Logf("Checked %d movie groups for clean English titles", checked)
}
