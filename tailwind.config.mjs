/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // 基础层：比原先更深，让玻璃层有对比空间
        ink: '#07080d',
        panel: '#111318',
        edge: '#232733',
        // 强调色：由玫红改为更现代的紫罗兰 + 青色副调
        accent: '#7c6cff',
        accent2: '#22d3ee',
      },
      boxShadow: {
        // 玻璃卡片的柔和投影（外层环境光 + 顶部内高光）
        glass:
          '0 1px 0 0 rgb(255 255 255 / 0.05) inset, 0 10px 30px -12px rgb(0 0 0 / 0.7)',
        'glass-hover':
          '0 1px 0 0 rgb(255 255 255 / 0.09) inset, 0 18px 44px -14px rgb(0 0 0 / 0.8)',
        glow: '0 0 0 1px rgb(124 108 255 / 0.35), 0 8px 30px -10px rgb(124 108 255 / 0.45)',
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
