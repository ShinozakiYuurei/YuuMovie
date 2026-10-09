package titles

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var mustNotCases = [][2]string{
	{"生化危機", "生化壽屍"},
	{"新世紀福音戰士新劇場版：序", "新世紀福音戰士新劇場版：破"},
	{"新世紀福音戰士新劇場版：Q", "新世紀福音戰士新劇場版：終"},
	{"復仇者聯盟4：終局之戰", "復仇者聯盟5：末日降臨"},
	{"蜘蛛俠：英雄重生", "蜘蛛俠：不戰無歸"},
	{"天鵝湖 (The Royal Ballet 2026 – 2027)", "天鵝湖 (Paris Opera Ballet 2026 - 2027)"},
	{"特別放映日記", "日記"},
	{"日記特別放映", "日記"},
	{"30周年修復版日記", "日記"},
	{"情書", "情書未寄出的一封信"},
}

var mustCases = [][2]string{
	{"奧德賽", "35mm 菲林版 奧德賽"},
	{"愛的綠洲", "愛的綠洲（35mm菲林版）"},
	{"我阿爹想旅行", "《我阿爹想旅行》中秋特典場"},
	{"奇愛博士 (NT Live 2026-27)", "奇愛博士 (NT Live)"},
	{"劇場版 CHIIKAWA 人魚島的秘密 (日語版)", "劇場版 CHIIKAWA 人魚島的秘密 (日)"},
	{"復仇者聯盟4：終局之戰 加碼重映", "(IV) 復仇者聯盟4：終局之戰 加碼重映"},
	{"蜘蛛俠：英雄重生", "蜘蛛俠: 英雄重生 (2D版)"},
	{"廚師發辦", "《廚師發辦》心跳回憶特典場"},
	{"以你的名字呼喚我", "以你的名字呼喚我 (特別放映)"},
	{"情書", "《情書》30周年修復版 (「相約在The One」特別放映)"},
	{"Oh My Ghost ! Oh My God!", "Oh My Ghost! Oh My God!(SP)"},
	{"怎麼可能我家的祖先是你家的鬼", "怎麽可能我家的祖先是你家的鬼(優先)"},
	{"CHIIKAWA the Movie: The Secret of the Mermaid Island", "CHIIKAWA the Movie: The Secret of the Mermaid Isla"},
	{"復仇者聯盟5：末日降臨", "開畫日特典首場 SCREENX - 復仇者聯盟5: 末日降臨 Infinity Vision"},
	{"復仇者聯盟5：末日降臨", "(IV) (開畫日特典首場) 復仇者聯盟5：末日降臨"},
	{"復仇者聯盟5：末日降臨", "(IV) (早鳥場) 復仇者聯盟5：末日降臨"},
	{"復仇者聯盟5：末日降臨", "復仇者聯盟5 末日降臨 早鳥"},
	{"柴可夫斯基《尤金．奧涅金》 (MET 2026)", "柴可夫斯基《尤金．奧涅金》 (The Met 2026)"},
	{"華格納《崔斯坦與伊索德》(The Met 2026)", "華格納《崔斯坦與伊索德》 (Met 2026)"},
	{"復仇者聯盟5：末日降臨", "復仇者聯盟5：末日降臨開畫日特典首場"},
	{"復仇者聯盟5：末日降臨", "復仇者聯盟5：末日降臨開畫日特典首場 (全景聲)"},
}

func TestDangerMergePairs(t *testing.T) {
	for _, p := range mustNotCases {
		a := NormalizeTitle(p[0])
		b := NormalizeTitle(p[1])
		if a == b {
			t.Errorf("误并: %q / %q -> %q", p[0], p[1], a)
		}
	}

	for _, p := range mustCases {
		a := NormalizeTitle(p[0])
		b := NormalizeTitle(p[1])
		if a != b {
			t.Errorf("漏并: %q (%q) / %q (%q)", p[0], a, p[1], b)
		}
	}

	for _, name := range []string{"The Sea (HKJFF 2026)", "Giant – The Play (2026)", "The Shoshani Riddle (HKJFF2026)"} {
		norm := NormalizeTitle(name)
		if !strings.Contains(norm, "the") {
			t.Errorf("误剥片名本体冠词: %q => %q", name, norm)
		}
	}
}

func TestDangerAvengers5RealData(t *testing.T) {
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "../../../data"
	}
	path := filepath.Join(dataDir, "movies.json")
	b, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("data/movies.json not found, skipping real-data avengers5 test")
		return
	}

	type movieItem struct {
		NameZh string `json:"nameZh"`
		Status string `json:"status"`
	}
	var movies []movieItem
	if err := json.Unmarshal(b, &movies); err != nil {
		t.Fatalf("failed to parse movies.json: %v", err)
	}

	groups := map[string][]string{}
	for _, m := range movies {
		k := NormalizeTitle(m.NameZh)
		if strings.Contains(k, "復仇者聯盟5") {
			groups[k] = append(groups[k], m.NameZh)
		}
	}

	if len(groups) > 1 {
		t.Errorf("復仇者聯盟5仍被拆成多個電影組: %v", groups)
	}
}
