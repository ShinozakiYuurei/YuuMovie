// Package ogcard 生成社交分享卡片图（Open Graph / X Card）。
//
// ===== 为什么需要它 =====
//
// 把站点链接贴到 X 上时，预览卡片要么没有图、要么被裁得不成样子：
//
//  1. 首页 / /showing / /upcoming / /cinema / 影院详情页的 metadata 里
//     **根本没有图片** —— X 只能显示一行干巴巴的文字（用户 2026-10-09 提出）。
//  2. 电影详情页虽然有 og:image，但那是**竖版海报**（2:3）。
//     X 的大图卡片是 1.91:1，竖图塞进去会被裁掉上下两端 ——
//     海报上的片名与主视觉恰好都在被裁掉的位置。
//
// 解法：构建期按页生成 1200×630 的横版卡片 ——
//   电影页把海报完整放在左侧、片名与场次信息排在右侧；
//   其余页面用统一的品牌卡。这样任何页面分享出去都有一张**为该页定制**的图。
//
// ===== 为什么用 Go 而不是 Node =====
//
// 抓取与构建期工具已整体迁到 goscraper（见 deploy/rebuild-static.sh 里的 bin/*），
// 卡片图属于同一类「构建期产物生成」。走 Go 二进制可以复用现成的编译与分发路径，
// VPS 上也不必再引入 sharp 这类原生依赖。
//
// ===== 为什么字体用站点自己的 woff2 =====
//
// VPS 上只有文泉驿（点阵感重、字形旧），而站点正文字体就是 Noto Sans HK。
// 卡片上的字必须和页面上的一致，否则分享出去像是另一个站。
// github.com/tdewolff/font 能直接解 woff2，因此直接把 app/fonts/ 里那个
// 可变字体文件喂进来即可，不需要在服务器上装字体、也不依赖 fontconfig。
package ogcard

import (
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"math"
	"os"

	"github.com/tdewolff/canvas"
	"github.com/tdewolff/canvas/renderers/rasterizer"
	xdraw "golang.org/x/image/draw"
)

// 卡片尺寸：X 的 summary_large_image 标准比例 1.91:1。
//
// 为什么是 1200×630 而不是 1200×628：这是 Open Graph 与 X 共同推荐值，
// Facebook / Slack / Discord 也都按这个尺寸取图，一张图通吃所有平台。
const (
	Width  = 1200
	Height = 630
	// DPI 决定「1 像素 = 多少画布单位」。canvas 内部用毫米，
	// 取 96 与 CSS 的 1px 定义一致，这样布局数字可以直接按像素写。
	DPI = 96.0
)

// 站点视觉令牌，与 app/globals.css 的 :root 同源。
// 卡片是站点的对外名片，配色必须与页面一致，因此改站点主题时要同步这里。
var (
	colCanvas  color.RGBA = canvas.Hex("#111113") // --hkm-canvas
	colFg      color.RGBA = canvas.Hex("#f4f4f5") // --hkm-fg
	colFgSoft  color.RGBA = canvas.Hex("#d4d4d8") // --hkm-fg-soft
	colFgMuted color.RGBA = canvas.Hex("#a1a1aa") // --hkm-fg-muted
	colFgDim   color.RGBA = canvas.Hex("#90909a") // --hkm-fg-dim
	colAccent  color.RGBA = canvas.Hex("#8b7cff") // --hkm-accent
	colScore   color.RGBA = canvas.Hex("#facc15") // --hkm-score-fg
)

// Fonts 持有一张已解析的字体，供卡片重复取 Face。
//
// 为什么复用同一个 *canvas.Font：Face() 会做 shaping（HarfBuzz），
// 而 190 部电影的卡片要渲染上千段文字 —— 每张卡片重新 LoadFont
// 会重复解 5.4MB 的 woff2（实测单次 ~120ms，累计几十秒）。
type Fonts struct {
	regular *canvas.Font
}

// LoadFonts 读取站点的中文字体（woff2）。
//
// 只用这一个文件：它是可变字体（wght 100–900），但 canvas 尚未实现可变轴
// （见 canvas.Font.SetVariations 的 TODO），默认实例是 Thin。
// 因此正文用 Thin 原样渲染，需要「粗体」的地方改用描边加粗 —— 见 boldStroke。
func LoadFonts(fontPath string) (*Fonts, error) {
	raw, err := os.ReadFile(fontPath)
	if err != nil {
		return nil, fmt.Errorf("读取字体 %s: %w", fontPath, err)
	}
	fnt, err := canvas.LoadFont(raw, 0, canvas.FontRegular)
	if err != nil {
		return nil, fmt.Errorf("解析字体 %s: %w", fontPath, err)
	}
	return &Fonts{regular: fnt}, nil
}

// Text 是一段待绘制的文字。
type Text struct {
	// Value 是文字内容
	Value string
	// Size 是字号（像素，按 96DPI 换算成 pt 交给 canvas）
	Size float64
	// Color 是颜色
	Color color.RGBA
	// Bold 是否加粗（描边模拟，见 boldStroke）
	Bold bool
}

// boldStroke 返回「把字加粗」所需的描边宽度（毫米）。
//
// ===== 为什么要用描边冒充粗体 =====
//
// 站点字体是可变字体，但 canvas 只实现到「默认实例」（Thin）——
// SetVariations 是空实现（库内 TODO）。而卡片标题必须是粗体，
// 否则 1200px 宽的图上会是一片发丝般的细字，远看糊成一片。
//
// 描边 = 沿字形轮廓向外扩一圈，视觉上就是加粗。
// 0.030 这个系数是实测定出来的：字号 58px 时约 1.7px 外扩，
// 观感接近 600–700 字重；再粗（0.045 以上）笔画开始粘连。
//
// 注意描边宽度随字号线性缩放：同一个系数在 24px 的小字上只有 0.7px，
// 在 58px 的标题上才是 1.7px —— 这正是排版上想要的比例关系。
func boldStroke(sizePx float64) float64 {
	return mm(sizePx * 0.030)
}

// mm 把像素换算成画布单位（毫米），96 DPI。
func mm(px float64) float64 { return px * 25.4 / DPI }

// pt 把像素换算成字号（pt）。canvas 的 Face(size) 收 pt。
func pt(px float64) float64 { return px * 72.0 / DPI }

// fromTop 把「从顶部量的像素」换算成画布 Y 坐标。
//
// ★ 这是本包最容易写错的地方：canvas 的坐标系原点在**左下角**、Y 轴**向上**，
// 而设计稿（以及 CSS）都是「从左上角往下量」。
// 所有纵向定位一律经过这个函数，不要手写 Height-xxx。
func fromTop(px float64) float64 { return mm(Height - px) }

// face 按 Text 描述取一个可绘制的字体面。
func (f *Fonts) face(t Text) *canvas.FontFace {
	if t.Bold {
		return f.regular.Face(pt(t.Size), t.Color, canvas.FontStroke(boldStroke(t.Size), t.Color))
	}
	return f.regular.Face(pt(t.Size), t.Color)
}

// Card 是一张正在绘制的卡片。
type Card struct {
	c   *canvas.Canvas
	ctx *canvas.Context
	f   *Fonts
}

// New 新建一张卡片画布，底色为站点画布色。
func New(f *Fonts) *Card {
	c := canvas.New(mm(Width), mm(Height))
	ctx := canvas.NewContext(c)
	ctx.SetFillColor(colCanvas)
	ctx.DrawPath(0, 0, canvas.Rectangle(mm(Width), mm(Height)))
	return &Card{c: c, ctx: ctx, f: f}
}

// FillRect 画一个实心矩形，(x, y) 是从**左上角**量的像素坐标。
func (c *Card) FillRect(x, y, w, h float64, col color.RGBA) {
	c.ctx.SetFillColor(col)
	c.ctx.DrawPath(mm(x), fromTop(y+h), canvas.Rectangle(mm(w), mm(h)))
}

// RoundRect 画圆角矩形（从左上角量）。
func (c *Card) RoundRect(x, y, w, h, r float64, col color.RGBA) {
	c.ctx.SetFillColor(col)
	c.ctx.DrawPath(mm(x), fromTop(y+h), canvas.RoundedRectangle(mm(w), mm(h), mm(r)))
}

// Glow 在 (cx, cy) 处铺一层径向光晕（从左上角量的像素坐标）。
//
// 用海报主色做光晕是卡片「有主题色」的关键 —— 与页面上卡片按海报取色
// 填充背景是同一套视觉语言。主色缺失时退回品牌紫。
func (c *Card) Glow(cx, cy, radius float64, col color.RGBA) {
	center := canvas.Point{X: mm(cx), Y: fromTop(cy)}
	g := canvas.NewRadialGradient(center, 0, center, mm(radius))
	g.Add(0.0, col)
	g.Add(1.0, color.RGBA{})
	c.ctx.SetFillGradient(g)
	c.ctx.DrawPath(0, 0, canvas.Rectangle(mm(Width), mm(Height)))
}

// Text 在 (x, y) 处画一行字。y 是**基线**位置（从顶部量）。
func (c *Card) Text(x, y float64, t Text) {
	if t.Value == "" {
		return
	}
	c.ctx.DrawText(mm(x), fromTop(y), canvas.NewTextLine(c.f.face(t), t.Value, canvas.Left))
}

// TextWidth 量一行字渲染后的宽度（像素）。用于居中与换行判断。
func (c *Card) TextWidth(t Text) float64 {
	return c.f.face(t).TextWidth(t.Value) * DPI / 25.4
}

// Image 把一张图按目标尺寸画到 (x, y)（从左上角量）。
//
// radius > 0 时做圆角裁切 —— canvas 的 Clip 只支持矩形，
// 圆角只能在**像素层**先裁好再贴，见 roundCorners。
func (c *Card) Image(x, y, w, h float64, img image.Image, radius float64) {
	if img == nil {
		return
	}
	scaled := scaleTo(img, int(math.Round(w)), int(math.Round(h)))
	if radius > 0 {
		scaled = roundCorners(scaled, radius)
	}
	c.ctx.DrawImage(mm(x), fromTop(y+h), scaled, canvas.DPI(DPI))
}

// Save 把卡片栅格化并写成 JPEG。
//
// 为什么是 JPEG 而不是 WebP：X / Facebook / Slack 都接受 WebP，
// 但 JPEG 的兼容面最广（部分老爬虫、部分即时通讯软件的预览仍只认 JPEG/PNG），
// 而照片类内容的 JPEG 体积已足够小（实测 1200×630 质量 86 约 90KB）。
func (c *Card) Save(path string, quality int) error {
	img := rasterizer.Draw(c.c, canvas.DPI(DPI), canvas.DefaultColorSpace)
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return jpeg.Encode(f, img, &jpeg.Options{Quality: quality})
}

// scaleTo 把任意图缩放到指定像素尺寸（保持铺满，超出部分居中裁掉）。
func scaleTo(src image.Image, w, h int) *image.RGBA {
	if w <= 0 || h <= 0 {
		return image.NewRGBA(image.Rect(0, 0, 1, 1))
	}
	b := src.Bounds()
	sw, sh := b.Dx(), b.Dy()
	if sw == 0 || sh == 0 {
		return image.NewRGBA(image.Rect(0, 0, w, h))
	}

	// cover：按较大的缩放比铺满，再居中裁切 —— 与 CSS object-fit: cover 一致。
	// 海报是 2:3 竖图、目标框也是 2:3，通常正好；其他比例也不会被拉伸变形。
	scale := math.Max(float64(w)/float64(sw), float64(h)/float64(sh))
	dw := int(math.Round(float64(sw) * scale))
	dh := int(math.Round(float64(sh) * scale))

	tmp := image.NewRGBA(image.Rect(0, 0, dw, dh))
	xdraw.CatmullRom.Scale(tmp, tmp.Bounds(), src, b, xdraw.Src, nil)

	out := image.NewRGBA(image.Rect(0, 0, w, h))
	offX := (dw - w) / 2
	offY := (dh - h) / 2
	draw.Draw(out, out.Bounds(), tmp, image.Pt(offX, offY), draw.Src)
	return out
}

// roundCorners 给一张图加圆角（把四角裁成透明）。
//
// 为什么在像素层做：canvas 的 Clip 只接受矩形（见 canvas.Canvas.Clip），
// 圆角矩形裁切得靠合成遮罩。直接在像素层算反而更简单可靠 ——
// 逐像素判距离，角落用一像素线性过渡做抗锯齿。
func roundCorners(src *image.RGBA, radius float64) *image.RGBA {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	r := math.Min(radius, math.Min(float64(w), float64(h))/2)
	out := image.NewRGBA(b)

	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			// 到最近圆角中心的距离，落在圆内即保留
			cx := math.Min(math.Max(float64(x)+0.5, r), float64(w)-r)
			cy := math.Min(math.Max(float64(y)+0.5, r), float64(h)-r)
			d := math.Hypot(float64(x)+0.5-cx, float64(y)+0.5-cy)
			cr, cg, cb, ca := src.At(b.Min.X+x, b.Min.Y+y).RGBA()
			switch {
			case d <= r:
				out.Set(x, y, color.RGBA{R: uint8(cr >> 8), G: uint8(cg >> 8), B: uint8(cb >> 8), A: uint8(ca >> 8)})
			case d <= r+1:
				// 边缘一像素做线性过渡，避免锯齿
				out.Set(x, y, color.RGBA{
					R: uint8(cr >> 8), G: uint8(cg >> 8), B: uint8(cb >> 8),
					A: uint8(float64(ca>>8) * (r + 1 - d)),
				})
			}
			// 圆外保持全透明（image.NewRGBA 初值即 0）
		}
	}
	return out
}
