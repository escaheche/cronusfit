/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./exhibition-site/**/*.{html,js,njk,md}', './admin/**/*.{html,js}'],
  theme: {
    extend: {
      colors: {
        brand: {
          blue: {
            DEFAULT: '#1e3a5f',
            light: '#2a4f7f',
            dark: '#0f1f33',
          },
          gold: {
            DEFAULT: '#c9a84c',
            light: '#d4ba6a',
            dark: '#a8893d',
          },
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        'glow': '0 0 40px rgba(201, 168, 76, 0.3)',
      },
    },
  },
  plugins: [],
};
