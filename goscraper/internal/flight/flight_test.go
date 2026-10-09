package flight

import (
	"reflect"
	"testing"
)

func TestFlightRecordsResolveDecimal(t *testing.T) {
	rsc := `"description_lang":"$37"` + "\n" + `37:T83e,{"en":"Hello","zh_hk":"你好"}`
	records := Records(rsc)
	got := LangField(records, "$37")
	want := map[string]string{"en": "Hello", "zh_hk": "你好"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestFlightRecordsResolveHex(t *testing.T) {
	rsc := `"description":"$3a"` + "\n" + `3a:T12,{"zh_hk":"中文簡介"}`
	records := Records(rsc)
	got := LangField(records, "$3a")
	want := map[string]string{"zh_hk": "中文簡介"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestTimestampNeverMistakenForRowID(t *testing.T) {
	if got := len(Records(`"createTime":"2026-01-28T03:11:08.542Z"`)); got != 0 {
		t.Errorf("got %d records, want 0", got)
	}
	if got := len(Records(`x37:T1,{"zh_hk":"不該命中"}`)); got != 0 {
		t.Errorf("got %d records, want 0", got)
	}
}

func TestUnresolvableRefYieldsEmptyMap(t *testing.T) {
	records := Records("")
	if got := LangField(records, "$3a"); len(got) != 0 {
		t.Errorf("got %v, want empty", got)
	}
	if got := LangField(records, "$999"); len(got) != 0 {
		t.Errorf("got %v, want empty", got)
	}
}

func TestInlineObjectsAndStringsPassThrough(t *testing.T) {
	records := Records("")
	got1 := LangField(records, map[string]any{"zh_hk": "中文"})
	if want := map[string]string{"zh_hk": "中文"}; !reflect.DeepEqual(got1, want) {
		t.Errorf("got %v, want %v", got1, want)
	}
	got2 := LangField(records, `{"zh_hk":"內層"}`)
	if want := map[string]string{"zh_hk": "內層"}; !reflect.DeepEqual(got2, want) {
		t.Errorf("got %v, want %v", got2, want)
	}
	got3 := LangField(records, "Love Is Not A Game")
	if want := map[string]string{"en": "Love Is Not A Game"}; !reflect.DeepEqual(got3, want) {
		t.Errorf("got %v, want %v", got3, want)
	}
}