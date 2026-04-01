/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./main.js"],
  theme: {
    extend: {
      colors: {
        cream: "#E5D2BB",
        terracotta: "#D05033",
        g900: "#000000",
        g850: "#131313",
        g800: "#1D1D1D",
      },
      fontFamily: {
        brand: ["RocaOne", "serif"],
        ui: ["Montserrat", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        stage: "0 20px 70px rgba(0,0,0,.55)",
      },
      borderRadius: {
        xl2: "18px",
      },
    },
  },
  plugins: [],
}

