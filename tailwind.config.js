/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#060c16',
        panel: '#0a1628',
        border: '#0f2240',
        accent: '#00d4aa',
        gold: '#f0c040',
        danger: '#ff4d6d',
        mid: '#7a9abf',
        dim: '#3a5570',
      },
      fontFamily: {
        display: ['var(--font-playfair)', 'Georgia', 'serif'],
        body: ['var(--font-ibm)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
    },
  },
  plugins: [],
}
