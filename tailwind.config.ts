import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

// Brand tokens sampled from the live freelanceatlas.com design:
// deep navy headings, steel-blue accent band, pale blue-grey surfaces.
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        atlasnavy: "#052335", // heading navy
        atlasteal: "#296488", // steel-blue accent (site CTA band)
        atlassand: "#EAF0F5", // mist band (site header background)
        atlassky: "#DCE9F6",  // soft illustration blue
        atlascloud: "#F5F7F9", // card container grey
      },
      fontFamily: {
        sans: ["var(--font-manrope)", "Manrope", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [typography],
};
export default config;
