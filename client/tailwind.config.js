/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        read: ['"Source Serif 4"', 'Georgia', 'serif'],
        ui: ['"DM Sans"', 'system-ui', 'sans-serif'],
        code: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        /* Verdigris (landing page) — scoped to the vg-* namespace */
        vg: {
          bg: 'var(--vg-bg)',
          char: 'var(--vg-char)',
          'char-2': 'var(--vg-char-2)',
          sidebar: 'var(--vg-sidebar)',
          surface: 'var(--vg-surface)',
          'surface-2': 'var(--vg-surface-2)',
          'surface-3': 'var(--vg-surface-3)',
          line: 'var(--vg-line)',
          'line-soft': 'var(--vg-line-soft)',
          text: 'var(--vg-text)',
          'text-2': 'var(--vg-text-2)',
          'text-3': 'var(--vg-text-3)',
          muted: 'var(--vg-muted)',
          accent: 'var(--vg-accent)',
          'accent-deep': 'var(--vg-accent-deep)',
          'accent-wash': 'var(--vg-accent-wash)',
          ink: 'var(--vg-ink)',
          clay: 'var(--vg-clay)',
          amber: 'var(--vg-amber)',
          red: 'var(--vg-red)',
        },
      },
      borderRadius: {
        none: '0px',
        sm: 'calc(var(--radius) - 4px)',
        md: 'calc(var(--radius) - 2px)',
        lg: 'var(--radius)',
        xl: 'calc(var(--radius) + 4px)',
        '2xl': 'calc(var(--radius) + 8px)',
        full: '9999px',
      },
      keyframes: {
        'atlas-fade-in': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'atlas-fade-in': 'atlas-fade-in 0.4s ease-out',
      },
    },
  },
  plugins: [],
};
