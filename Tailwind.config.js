/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts}'],
  theme: {
    extend: {
      colors: {
        jellyfin: {
          bg: '#101010',
          surface: '#1a1a1a',
          card: '#222222',
          accent: '#00a4dc',
          text: '#ffffff',
          muted: '#888888',
        }
      },
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
        display: ['Outfit', 'sans-serif'],
      }
    }
  },
  plugins: []
}