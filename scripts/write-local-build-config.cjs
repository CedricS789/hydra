const fs = require("node:fs");

// Public service origins from the official 4.4.1 build. No account credentials.
const defaults = {
  MAIN_VITE_API_URL: "https://hydra-api-us-east-1.losbroxas.org",
  MAIN_VITE_AUTH_URL: "https://auth.hydra.losbroxas.org",
  MAIN_VITE_CHECKOUT_URL: "https://checkout.hydralauncher.gg",
  MAIN_VITE_EXTERNAL_RESOURCES_URL: "https://cdn.losbroxas.org",
  RENDERER_VITE_EXTERNAL_RESOURCES_URL: "https://cdn.losbroxas.org",
  MAIN_VITE_LAUNCHER_SUBDOMAIN: "",
};

fs.writeFileSync(
  ".env.production",
  Object.entries(defaults)
    .map(([key, fallback]) => `${key}=${process.env[key] ?? fallback}`)
    .join("\n") + "\n"
);
process.stdout.write(
  "Wrote public service build configuration; no credentials are included.\n"
);
