/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Apple style system-ui fallback to Inter for Linux/Win
        sans: ['system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'Inter', 'sans-serif'],
      },
      colors: {
        // Apple Cupertino inspired neutral palette
        apple: {
          bg: '#fbfbfd',
          darkBg: '#1c1c1e',
          sidebar: '#f5f5f7',
          darkSidebar: '#2c2c2e',
          text: '#1d1d1f',
          darkText: '#f5f5f7',
          blue: '#007aff',
          darkBlue: '#0a84ff',
          border: '#d2d2d7',
          darkBorder: '#38383a'
        }
      },
      backdropBlur: {
        'apple': '20px',
      }
    },
  },
  plugins: [],
}
