package titles

import (
	"regexp"
	"strings"
	"testing"
)

func strPtr(s string) *string {
	return &s
}

type VersionCase struct {
	Name string
	Lang *string
	Want string
	Why  string
}

var versionCases = []VersionCase{
	{"IMAX 復仇者聯盟4", strPtr("英語"), "IMAX·英語", "IMAX 没有语言标记，用影片对白语言兜底"},
	{"35mm 菲林版 奧德賽", strPtr("英語"), "35mm 菲林版·英語", "菲林版是放映规格，要保留；显示名走 formatLabel"},
	{"霸王別姬 (4K修復版)", strPtr("國語"), "4K 修復版·國語", "4K 修復版属于规格；formatLabel 会补空格成「4K 修復版」"},
	{"4DX 劇場版 CHIIKAWA (日語版)", strPtr("日語"), "4DX·日語", "规格 4DX + 语言标记日語版 -> 语言取自标记"},
	{"4DX 劇場版 CHIIKAWA (日語版)", strPtr("英語"), "4DX·日語", "版本自带的语言优先于影片整体语言"},
	{"粵語版 汪汪隊", strPtr("英語"), "粵語版", "无放映规格时语言标记本身就是版本，不再缀「·粵語」重复一遍"},
	{"日語版 蠟筆小新", strPtr("粵語"), "日語版", "同上；且不受影片整体语言影响"},
	{"生化危機", strPtr("英語"), "原版·英語", "原版也要带语言，而不是只写「原版」"},
	{"八仙！", nil, "原版", "影片语言缺失时退化成裸「原版」，不留孤立的分隔符"},
	{"IMAX 奧德賽", nil, "IMAX", "没有语言就不缀「·」"},
	{"復仇者聯盟4 加碼重映", strPtr("英語"), "原版·英語", "版本部分只含放映规格与语言，「加碼重映」是放映轮次不是规格"},
	{"《廚師發辦》心跳回憶特典場", strPtr("粵語"), "原版·粵語", "特典場是场次类型，不是放映规格"},
	{"BTS LIVE VIEWING (2026)", strPtr("英語"), "原版·英語", "Live Viewing 是活动标记，不是规格"},
	{"故鄉異客 (GFF)", strPtr("粵語"), "原版·粵語", "影展名是活动标记，不是规格"},
	{"【Infinity Vision】復仇者聯盟4", strPtr("英語"), "原版·英語", "活动标签不是规格"},
	{"復仇者聯盟4 加碼重映 (全景聲)", strPtr("英語"), "全景聲·英語", "全景聲是规格要留，加碼重映要丢"},
	{"IMAX 復仇者聯盟4 加碼重映", strPtr("英語"), "IMAX·英語", "规格与活动标记混写：只留 IMAX"},
	{"IMAX 4DX 某某片", strPtr("英語"), "IMAX + 4DX·英語", "多个规格用 + 连接"},
}

var activityTokens = []string{
	"加碼重映", "重映", "特典場", "應援場", "優先場", "Encore", "Live Viewing", "GFF", "Infinity Vision",
}

var poisonCases = [][2]interface{}{
	{"IMAX 生化危機 加碼重映", strPtr("英語")},
	{"MX4D 復仇者聯盟4 特典場", strPtr("英語")},
	{"《我阿爹想旅行》中秋特典場", strPtr("粵語")},
	{"汪汪隊 (粵語版)", strPtr("粵語")},
	{"奧德賽 IMAX with Laser", strPtr("英語")},
	{"House 5/IMAX* 某某片", strPtr("英語")},
}

func TestVersionTextCases(t *testing.T) {
	for _, c := range versionCases {
		fmts := ExtractFormats(c.Name)
		got := FormatVersionText(fmts, c.Lang)
		if got != c.Want {
			t.Errorf("%s: got %q, want %q (reason: %s)", c.Name, got, c.Want, c.Why)
		}
	}
}

var (
	reVerLangRepeat = regexp.MustCompile(`(版)·`)
	reHouseNumber   = regexp.MustCompile(`\d+院|House \d`)
)

func TestVersionTextPoisonGuards(t *testing.T) {
	allChecks := make([][2]interface{}, 0, len(versionCases)+len(poisonCases))
	for _, c := range versionCases {
		allChecks = append(allChecks, [2]interface{}{c.Name, c.Lang})
	}
	allChecks = append(allChecks, poisonCases...)

	for _, pair := range allChecks {
		name := pair[0].(string)
		var lang *string
		if pair[1] != nil {
			lang = pair[1].(*string)
		}
		fmts := ExtractFormats(name)
		out := FormatVersionText(fmts, lang)

		for _, act := range activityTokens {
			if strings.Contains(out, act) {
				t.Errorf("活动标记漏进文案：%q -> %q (含 %q)", name, out, act)
			}
		}

		if reVerLangRepeat.MatchString(out) && strings.Contains(out, "·") {
			parts := strings.Split(out, "·")
			if len(parts) == 2 && strings.HasSuffix(parts[0], "版") {
				if strings.TrimSuffix(parts[0], "版") == parts[1] {
					t.Errorf("语言重复：%q -> %q", name, out)
				}
			}
		}

		if strings.HasSuffix(out, "·") || strings.Contains(out, "··") {
			t.Errorf("孤立分隔符：%q -> %q", name, out)
		}

		if reHouseNumber.MatchString(out) {
			t.Errorf("影厅名混入：%q -> %q", name, out)
		}
	}
}
