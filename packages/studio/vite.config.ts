import { defineConfig } from "vite";

/**
 * The Vite config for `@openlogo/studio`'s browser host (#277 — see
 * `docs/adr/0011-studio-app-bundler.md`). This only bundles the DOM-facing `index.html`/`web/`
 * entry; the library itself still builds via `tsc -b` (`npm run build`), unaffected by Vite.
 */
export default defineConfig({
  root: ".",
  publicDir: "web/public",
  build: {
    outDir: "web-dist",
  },
});
