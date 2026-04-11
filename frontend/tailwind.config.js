/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#fff1f4',
          100: '#ffe4ea',
          200: '#ffccd9',
          300: '#ffa0b8',
          400: '#ff6c93',
          500: '#f93c6e',
          600: '#e6184f',
          700: '#c20e3f',
          800: '#a10f39',
          900: '#891036',
          950: '#4c0419',
        },
        cream: {
          50:  '#fdfaf5',
          100: '#faf4e8',
          200: '#f5e8d0',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
}
