/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'eve-bg': '#0e0e10',
        'eve-surface': '#111827',
        'eve-elevated': '#1e293b',
        'eve-border': '#334155',
        'eve-text': '#f1f5f9',
        'eve-muted': '#94a3b8',
        'eve-accent': '#f59e0b',
        'eve-accent-hover': '#fbbf24',
        'eve-accent-muted': 'rgba(245, 158, 11, 0.12)',
        'eve-danger': '#f43f5e',
        'eve-row-alt': 'rgba(30, 41, 59, 0.5)',
        'eve-highlight': 'rgba(245, 158, 11, 0.08)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
        tabular: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
