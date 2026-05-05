import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0e0f13",
          card: "#171821",
          elevated: "#1f212c",
        },
        border: {
          DEFAULT: "#2a2c39",
        },
        accent: {
          DEFAULT: "#7c5cff",
          hover: "#9078ff",
        },
        steam: {
          DEFAULT: "#1b2838",
          accent: "#66c0f4",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
