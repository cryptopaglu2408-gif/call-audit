import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          green: "#22c55e",
          dark: "#0f3a2d",
          softGreen: "#dcfce7",
          purple: "#7c3aed",
          softPurple: "#ede9fe",
        },
        kpi: {
          lavender: "#ede9fe",
          blue: "#e0eaff",
          pink: "#fce7f3",
          peach: "#ffe4e1",
        },
      },
      borderRadius: {
        "2xl": "18px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 23, 42, 0.04)",
      },
      fontFamily: {
        sans: ['"Inter"', "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
