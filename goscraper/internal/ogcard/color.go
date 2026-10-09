package ogcard

import (
	"image/color"

	"github.com/tdewolff/canvas"
)

// Hex 把 #rrggbb 解析成 color.RGBA。
//
// 为什么要在这里再导出一层：调用方（cmd/ogcardgen）要用海报主色给卡片上光晕，
// 而从调用方直接 import canvas 会把绘制库的依赖泄出去 ——
// 调用方只该知道「颜色字符串 → 颜色值」这件事。
func Hex(s string) color.RGBA { return canvas.Hex(s) }
