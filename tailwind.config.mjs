/** @type {import('tailwindcss').Config} */

/*
 * ⚠️ 本文件在 Tailwind v4 下**不会被读取**（除非在 CSS 里加 @config 指令）。
 * 真正生效的设计令牌在 app/globals.css 的 :root / @theme 块。
 *
 * 保留此文件只为两件事：
 *   1. 兼容仍会读取它的工具（编辑器插件、格式化器等）；
 *   2. 万一日后有人重新启用 @config，值不至于与 globals.css 冲突。
 *
 * ★ 2026-09-21 已同步到新的暗色体系：
 *   ink #07080d → canvas #0A0A0C（带冷蓝倾向，拒绝死气沉沉的纯黑）
 *   panel #111318 → surface #18181B（比底层亮一档）
 *   并补上 hairline（1px、8% 白的发丝边框，卡片浮起的关键）。
 * 改 globals.css 时请顺手同步这里，否则两边会静默漂移。
 * ★ 2026-09-25 新增明／暗双主题：
 *   本文件里那套**写死的暗色值**已经不完整了 —— 它没有、也无法表达
 *   「同一个令牌在两套主题下取不同值」。真正的单一事实源是
 *   globals.css 的 :root（暗）与 html[data-theme='light']（明），
 *   这里保留的色值仅供仍会读本文件的工具参考，**默认按暗色**。
 *   若你的工具报出的颜色与页面不符，请先确认页面当前是哪个主题。
 */
export default {
  // 主题由 <html data-theme> 控制（见 app/layout.tsx 的启动脚本），
  // 不是靠 .dark 类切换。
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // 基础层：与 globals.css 的 --hkm-canvas / --hkm-surface 对齐
        //
        // ⚠️ 下面全部是**暗色**取值。明色下这些 key 在页面上的实际颜色
        //    由 globals.css 的 html[data-theme='light'] 覆盖 ——
        //    本文件只是镜像，不参与明色主题的计算。
        ink: '#0a0a0c',
        canvas: '#0a0a0c',
        panel: '#18181b',
        surface: '#18181b',
        edge: '#ffffff14',
        hairline: '#ffffff14',
        // 文字层级
        fg: '#f4f4f5',
        'fg-soft': '#d4d4d8',
        'fg-muted': '#a1a1aa',
        'fg-dim': '#8a8a94',
        // 强调色：紫罗兰 + 青色副调
        accent: '#8b7cff',
        accent2: '#67e8f9',
      },
      boxShadow: {
        // 实心表面 + 极克制投影（不再是玻璃拟态的大范围光晕）
        glass: 'inset 0 1px 0 0 rgb(255 255 255 / 0.03), 0 1px 2px rgb(0 0 0 / 0.4)',
        'glass-hover':
          'inset 0 1px 0 0 rgb(255 255 255 / 0.05), 0 8px 24px -16px rgb(0 0 0 / 0.9)',
        glow: '0 0 0 1px rgb(139 124 255 / 0.3), 0 8px 30px -14px rgb(139 124 255 / 0.4)',
      },
      backdropBlur: {
        xs: '2px',
      },
      keyframes: {
        'aurora-drift': {
          '0%, 100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '50%': { transform: 'translate3d(2%, -2%, 0) scale(1.06)' },
        },
      },
      animation: {
        'aurora-drift': 'aurora-drift 24s ease-in-out infinite',
      },
    },
  },
};
