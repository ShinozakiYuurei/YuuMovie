package ogcard

import (
	"image"
	"image/color"
	"math"
	"strings"
)

// 版面常量。数值按「从左上角量的像素」写，绘制时由 ogcard.go 里的
// fromTop / mm 换算到 canvas 的左下原点坐标系。
const (
	padX = 80.0 // 左右安全边距
	padY = 64.0 // 上下安全边距

	// 海报书架（品牌卡 / 列表卡 / 影院卡底部那排海报）
	shelfPosterW = 168.0
	shelfPosterH = 252.0
	shelfGap     = 20.0

	// 卡片上要显示海报时统一用的圆角半径（与页面上 rounded-2xl 的比例一致）
	posterRadius = 16.0
)

// 半透明色的便捷构造（canvas.RGBA 收 0–1 的 alpha）。
func rgbaA(c color.RGBA, a float64) color.RGBA {
	return color.RGBA{R: c.R, G: c.G, B: c.B, A: uint8(float64(c.A) * a)}
}

var (
	colHairline   = color.RGBA{R: 255, G: 255, B: 255, A: 20}  // rgb(255 255 255 / 0.08)
	colPosterEdge = color.RGBA{R: 255, G: 255, B: 255, A: 36}  // rgb(255 255 255 / 0.14)
	colPillFill   = color.RGBA{R: 255, G: 255, B: 255, A: 26}  // rgb(255 255 255 / 0.10)
	colPillEdge   = color.RGBA{R: 255, G: 255, B: 255, A: 41}  // rgb(255 255 255 / 0.16)
)

// MovieCard 是电影详情页卡片的输入。
type MovieCard struct {
	Title    string
	Subtitle string // 英文片名，可空
	Meta     string // 「2026-10-01 上映 · 88分鐘 · IIB · 粵語」
	Rating   string // 「IMDb 4.3」，可空
	Extra    string // 「12 場 · 3 間院線」，可空
	Poster   image.Image
	Accent   color.RGBA // 海报主色，用于背景光晕
}

// ShelfCard 是「一排海报 + 标题区」卡片的输入。
//
// 品牌卡（首页）、列表卡（/showing 等）、影院卡共用这套版面 ——
// 它们的结构本来就是同一种：一句标题、一行说明、若干标签、一排海报。
// 差别只在文案与是否居中，因此用参数而不是三份重复代码。
type ShelfCard struct {
	// Title 主标题；CenterTitle 为 true 时居中
	Title string
	// TitleAccent 标题里要着品牌色的后缀（品牌卡把 YuuMovie 的 Movie 染色）
	TitleAccent string
	// Subtitle 标题下方的说明行
	Subtitle string
	// Pills 标签行（统计 / 影厅规格）
	Pills []string
	// Posters 底部书架，最多 5 张
	Posters []image.Image
	// Footer 右下角小字
	Footer string
	// Accent 背景光晕颜色
	Accent color.RGBA
	// CenterTitle 标题与标签是否居中（品牌卡、列表卡居中；影院卡左对齐）
	CenterTitle bool
}

// 标题区的排版参数
const (
	titleSize    = 54.0
	titleSizeBig = 74.0 // 品牌卡的字号更大
	subtitleSize = 27.0
	metaSize     = 25.0
	pillSize     = 22.0
	pillH        = 42.0
	footerSize   = 23.0
)

// RenderMovie 画电影详情页卡片。
//
// 版面：左侧海报（300×450，保持 2:3 不变形），右侧片名与资料。
// 海报用 2:3 完整展示而不是铺满整张卡 —— 竖版海报是用户认片的唯一依据，
// 裁掉上下两端等于把片名与主视觉一起裁掉（这正是当前 og:image 的毛病）。
func RenderMovie(f *Fonts, in MovieCard) *Card {
	c := New(f)

	// 背景光晕取海报主色，与页面上「卡片按海报取色」是同一套语言。
	accent := in.Accent
	if accent.A == 0 {
		accent = colAccent
	}
	c.Glow(210, 420, 900, rgbaA(accent, 0.30))

	const (
		posterX = padX
		posterY = 90.0
		posterW = 300.0
		posterH = 450.0
	)

	if in.Poster != nil {
		// 先铺一层比海报略大的圆角底，让海报有一圈发丝边框（与页面上一致）
		c.RoundRect(posterX-2, posterY-2, posterW+4, posterH+4, posterRadius+2, colPosterEdge)
		c.Image(posterX, posterY, posterW, posterH, in.Poster, posterRadius)
	}

	textX := posterX + posterW + 56
	textW := Width - textX - padX

	// ---- 标题：最多两行，放不下就缩字号 ----
	titleLines, titleFontSize := fitLines(c, in.Title, textW, 2, []float64{titleSize, 46, 40, 34}, true)
	y := 158.0
	for _, line := range titleLines {
		c.Text(textX, y, Text{Value: line, Size: titleFontSize, Color: colFg, Bold: true})
		y += titleFontSize * 1.18
	}

	// ---- 英文片名 ----
	if in.Subtitle != "" {
		y += 6
		subLines, subSize := fitLines(c, in.Subtitle, textW, 1, []float64{subtitleSize, 24, 21, 18}, false)
		for _, line := range subLines {
			c.Text(textX, y, Text{Value: line, Size: subSize, Color: colFgMuted})
		}
		y += subSize * 1.3
	}

	// ---- 品牌色短线：分隔标题区与资料区 ----
	y += 22
	c.FillRect(textX, y-4, 72, 5, colAccent)
	y += 30

	// ---- 资料行（上映日期 / 片长 / 级别 / 语言）----
	if in.Meta != "" {
		lines, size := fitLines(c, in.Meta, textW, 2, []float64{metaSize, 22, 19}, false)
		for _, line := range lines {
			c.Text(textX, y, Text{Value: line, Size: size, Color: colFgSoft})
			y += size * 1.35
		}
	}

	// ---- 场次 / 评分：资料行下方并排两枚标签 ----
	//
	// 两枚标签在同一行，x 按前一枚的实际宽度推进；一行放不下就换行 ——
	// 直接叠画会糊成一团，而卡片上没有任何东西提示它叠了。
	chipY := y + 16
	if in.Extra != "" {
		c.Pill(textX, chipY, in.Extra, colPillFill, colPillEdge, colFgSoft)
	}
	if in.Rating != "" {
		// 评分用站点统一的亮黄（--hkm-score-fg），与页面评分卡同色
		ratingX := textX
		if in.Extra != "" {
			ratingX += measurePill(c, in.Extra) + 12
		}
		if ratingX+measurePill(c, in.Rating) > textX+textW {
			ratingX = textX
			chipY += pillH + 10
		}
		c.Pill(ratingX, chipY, in.Rating, rgbaA(colScore, 0.14), rgbaA(colScore, 0.34), colScore)
	}

	c.Footer("YuuMovie", "全港戲院場次 · 票價 · 官方購票連結")
	return c
}

// RenderShelf 画「标题 + 标签 + 一排海报」的卡片（品牌卡 / 列表卡 / 影院卡）。
func RenderShelf(f *Fonts, in ShelfCard) *Card {
	c := New(f)

	accent := in.Accent
	if accent.A == 0 {
		accent = colAccent
	}
	if in.CenterTitle {
		c.Glow(Width/2, 250, 980, rgbaA(accent, 0.26))
	} else {
		c.Glow(300, 260, 900, rgbaA(accent, 0.24))
	}

	y := 150.0
	if in.CenterTitle {
		// 标题居中：两段不同颜色要分别量宽，再按总宽定位
		size := titleSizeBig
		w1 := c.TextWidth(Text{Value: in.Title, Size: size, Bold: true})
		w2 := 0.0
		if in.TitleAccent != "" {
			w2 = c.TextWidth(Text{Value: in.TitleAccent, Size: size, Bold: true})
		}
		x := (Width - w1 - w2) / 2
		c.Text(x, y, Text{Value: in.Title, Size: size, Color: colFg, Bold: true})
		if in.TitleAccent != "" {
			c.Text(x+w1, y, Text{Value: in.TitleAccent, Size: size, Color: colAccent, Bold: true})
		}
		y += 62
	} else {
		lines, size := fitLines(c, in.Title, Width-padX*2, 1, []float64{titleSize, 46, 40, 34}, true)
		for _, line := range lines {
			c.Text(padX, y, Text{Value: line, Size: size, Color: colFg, Bold: true})
		}
		y += 56
	}

	if in.Subtitle != "" {
		lines, size := fitLines(c, in.Subtitle, Width-padX*2, 1, []float64{subtitleSize, 24, 21, 18}, false)
		for _, line := range lines {
			if in.CenterTitle {
				w := c.TextWidth(Text{Value: line, Size: size})
				c.Text((Width-w)/2, y, Text{Value: line, Size: size, Color: colFgMuted})
			} else {
				c.Text(padX, y, Text{Value: line, Size: size, Color: colFgMuted})
			}
		}
		y += size * 1.4
	}

	// ---- 标签行 ----
	if len(in.Pills) > 0 {
		y += 14
		y = c.PillRow(padX, y, Width-padX*2, in.Pills, in.CenterTitle)
		y += 16
	}

	// ---- 海报书架 ----
	if len(in.Posters) > 0 {
		n := len(in.Posters)
		if n > 5 {
			n = 5
		}
		total := float64(n)*shelfPosterW + float64(n-1)*shelfGap
		x := (Width - total) / 2
		// 书架底对齐：整排海报的下沿统一，上沿参差会显得没做完
		shelfY := math.Min(y+18, Height-padY-56-shelfPosterH)
		for i := 0; i < n; i++ {
			px := x + float64(i)*(shelfPosterW+shelfGap)
			c.RoundRect(px-1.5, shelfY-1.5, shelfPosterW+3, shelfPosterH+3, posterRadius+1.5, colPosterEdge)
			c.Image(px, shelfY, shelfPosterW, shelfPosterH, in.Posters[i], posterRadius)
		}
	}

	c.Footer("YuuMovie", in.Footer)
	return c
}

// ---- 绘制辅助 ----

// TextRight 在 x 处右对齐画一行字。
func (c *Card) TextRight(x, y float64, t Text) {
	if t.Value == "" {
		return
	}
	w := c.TextWidth(t)
	c.Text(x-w, y, t)
}

// measurePill 量一枚标签的宽度（含左右内边距）。
func measurePill(c *Card, label string) float64 {
	if label == "" {
		return 0
	}
	return c.TextWidth(Text{Value: label, Size: pillSize}) + 36
}

// Pill 画一枚圆角标签，返回其底边 y（供同一行继续排）。
func (c *Card) Pill(x, y float64, label string, fill, edge color.RGBA, fg color.RGBA) float64 {
	if label == "" {
		return y
	}
	w := measurePill(c, label)
	c.RoundRect(x, y, w, pillH, pillH/2, edge)
	c.RoundRect(x+1.5, y+1.5, w-3, pillH-3, (pillH-3)/2, fill)
	tw := c.TextWidth(Text{Value: label, Size: pillSize})
	c.Text(x+(w-tw)/2, y+pillH/2+pillSize*0.36, Text{Value: label, Size: pillSize, Color: fg})
	return y + pillH
}

// PillRow 画一排标签。maxWidth 给定时按需换行；center 为真则整行居中。
// PillRow 画一排标签，返回排完后的底边 y（供调用方接着往下排）。
// maxWidth 给定时按需换行；center 为真则整行居中。
func (c *Card) PillRow(x, y, maxWidth float64, labels []string, center bool) float64 {
	const gap = 12.0
	if len(labels) == 0 {
		return y
	}

	// 先按行分组，避免把一枚标签拆到两行
	var rows [][]string
	var cur []string
	curW := 0.0
	for _, l := range labels {
		w := measurePill(c, l)
		if len(cur) > 0 && curW+gap+w > maxWidth {
			rows = append(rows, cur)
			cur = nil
			curW = 0
		}
		cur = append(cur, l)
		curW += w + gap
	}
	if len(cur) > 0 {
		rows = append(rows, cur)
	}

	for _, row := range rows {
		total := 0.0
		for _, l := range row {
			total += measurePill(c, l)
		}
		total += float64(len(row)-1) * gap
		px := x
		if center {
			px = x + (maxWidth-total)/2
		}
		for _, l := range row {
			c.Pill(px, y, l, colPillFill, colPillEdge, colFgSoft)
			px += measurePill(c, l) + gap
		}
		y += pillH + 10
	}
	return y
}

// Footer 画卡片底部的品牌行：一条发丝线 + 左侧字标 + 右侧小字。
func (c *Card) Footer(brand, right string) {
	const y = Height - padY
	c.FillRect(padX, y-52, Width-padX*2, 1, colHairline)
	c.Text(padX, y, Text{Value: brand, Size: 30, Color: colFg, Bold: true})
	if right != "" {
		c.TextRight(Width-padX, y, Text{Value: right, Size: footerSize, Color: colFgDim})
	}
}

// fitLines 把一段文字折成最多 maxLines 行，必要时逐级缩小字号。
//
// ===== 为什么要「先折行、再缩字号」=====
//
// 卡片上的文字长度完全不受控：片名从「偵戰」到
// 「IRyS 1st Concert HOPE ||: Beyond the Stars - in Cinemas」都有，
// 影院名从「新光黃埔影藝城」到「英皇戲院（澳門葡京人）」都有。
// 固定字号下要么溢出画面、要么被截断成看不懂的半句。
//
// 规则：先在最大字号下折行；若行数超了，退到下一档字号重来。
// 全部档位都试过仍放不下时，用最小字号截断并加省略号 ——
// 宁可显示「…」也不要让文字压到画面外。
//
// 折行点：中文逐字断，拉丁文优先在空格处断（退而求其次才逐字断）——
// 中文没有词边界，逐字断是唯一选择；英文若也逐字断会断成
// 「YuuMovi / e」这种，读起来是坏的。
func fitLines(c *Card, s string, maxWidth float64, maxLines int, sizes []float64, bold bool) ([]string, float64) {
	if s == "" || maxWidth <= 0 {
		return nil, sizes[len(sizes)-1]
	}
	for i, size := range sizes {
		lines, overflow := wrapRunes(c, s, size, maxWidth, maxLines, bold)
		if !overflow {
			return lines, size
		}
		if i == len(sizes)-1 {
			return lines, size
		}
	}
	return []string{s}, sizes[len(sizes)-1]
}

// wrapRunes 按给定字号折行。overflow 表示还有内容放不下（已被截断）。
func wrapRunes(c *Card, s string, size, maxWidth float64, maxLines int, bold bool) ([]string, bool) {
	width := func(v string) float64 {
		return c.TextWidth(Text{Value: v, Size: size, Bold: bold})
	}

	runes := []rune(s)
	var lines []string
	var cur []rune

	flush := func() {
		lines = append(lines, strings.TrimRight(string(cur), " "))
		cur = nil
	}

	for i := 0; i < len(runes); i++ {
		r := runes[i]
		if len(cur) == 0 && r == ' ' {
			continue // 行首空格丢弃
		}
		cur = append(cur, r)
		if width(string(cur)) <= maxWidth {
			continue
		}
		// 超宽：退掉刚加的这个字，再找断点
		cur = cur[:len(cur)-1]

		brk := -1
		// 拉丁文优先在最近的空格断（只回看 24 个字符，避免为了一个空格
		// 把整行都推下去，那样会留下大片空白）
		for j := len(cur) - 1; j >= 0 && j > len(cur)-24; j-- {
			if cur[j] == ' ' {
				brk = j
				break
			}
		}

		if brk > 0 {
			rest := append([]rune{}, cur[brk+1:]...)
			cur = cur[:brk]
			flush()
			cur = append(rest, r)
		} else {
			flush()
			cur = []rune{r}
		}

		if len(lines) == maxLines {
			// 已经写满允许的行数，剩下的内容并入最后一行并截断
			remainder := append(cur, runes[i+1:]...)
			last := strings.TrimRight(string(remainder), " ")
			if width(last) > maxWidth {
				// 逐字回退到放得下为止，再加省略号
				rr := []rune(last)
				for len(rr) > 1 && width(string(rr)+"…") > maxWidth {
					rr = rr[:len(rr)-1]
				}
				last = string(rr) + "…"
			}
			lines = append(lines, last)
			return lines, true
		}
	}

	if len(cur) > 0 {
		flush()
	}
	return lines, false
}
