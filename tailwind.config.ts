import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        atlasnavy: "#0F2A43",
        atlasteal: "#1C7C75",
        atlassand: "#F6F1E7",
      },
    },
  },
  plugins: [],
};
export default config;
