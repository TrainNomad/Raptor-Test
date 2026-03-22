/* ============================================================
   TrainNomad.eu — script/tailwind.config.js
   Configuration Tailwind CSS (doit être chargé APRÈS tailwind CDN)
   ============================================================ */

tailwind.config = {
    darkMode: "class",
    theme: {
        extend: {
            colors: {
                "primary":           "#4ade80",
                "midnight":          "#1A2B3C",
                "background-light":  "#f8f7f5",
            },
            fontFamily: {
                "display": ["Plus Jakarta Sans", "sans-serif"],
            },
            borderRadius: {
                "DEFAULT": "0.25rem",
                "lg":      "0.5rem",
                "xl":      "0.75rem",
                "2xl":     "1rem",
                "full":    "9999px",
            },
        },
    },
};