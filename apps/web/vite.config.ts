import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Development (docs/product/10-l2-newsroom-plan.md §7.1): the web app on 127.0.0.1:5180, and /api passed on to the
// API (127.0.0.1:8780 unless PGN_DEV_API names another), so the browser sees one origin, as in production: no CORS,
// and the API's Origin guard sees the origin it expects (PGN_ALLOWED_ORIGINS, by default http://127.0.0.1:5180).
// `vite preview` serves the production build the same way.
const api = process.env["PGN_DEV_API"] ?? "http://127.0.0.1:8780";
const server = { host: "127.0.0.1", port: 5180, strictPort: true, proxy: { "/api": { target: api } } };

export default defineConfig({
  plugins: [react()],
  server,
  preview: server,
});
