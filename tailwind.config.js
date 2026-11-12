/** Tailwind config untuk build statis RABIT.
 *  Menggantikan CDN cdn.tailwindcss.com (dev-only, ~400KB, render blocking).
 */
module.exports = {
  darkMode: "class",
  content: [
    "./*.html",
    "./*.js",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
      },
      colors: {
        crm: {
          active: "#1e4a42",
          activeHover: "#163b35",
          blue: "#00529b",
          textMuted: "#52606d",
          border: "#e2e8f0",
          bgCanvas: "#f8fafc",
          card: "#ffffff",
        },
      },
    },
  },
  plugins: [
    require("@tailwindcss/forms"),
  ],
};
