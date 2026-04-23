import path from "path";

import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { relayShim } from "@hypr/plugin-relay/vite";

import { changelog } from "./plugins/changelog";

const shimDir = path.resolve(__dirname, "src/browser-shims");

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    relayShim(),
    changelog(),
    tanstackRouter({ target: "react", autoCodeSplitting: false }),
    react(),
  ],
  resolve: {
    tsconfigPaths: true,
    alias: {
      // Tauri core APIs
      "@tauri-apps/api/core": path.join(shimDir, "tauri-core.ts"),
      "@tauri-apps/api/webviewWindow": path.join(
        shimDir,
        "tauri-webview-window.ts",
      ),
      "@tauri-apps/api/event": path.join(shimDir, "tauri-event.ts"),
      "@tauri-apps/api/path": path.join(shimDir, "tauri-path.ts"),
      "@tauri-apps/api/app": path.join(shimDir, "tauri-app.ts"),
      // Tauri plugins
      "@tauri-apps/plugin-os": path.join(shimDir, "tauri-plugin-os.ts"),
      "@tauri-apps/plugin-autostart": path.join(
        shimDir,
        "tauri-plugin-autostart.ts",
      ),
      // @hypr plugins
      "@hypr/plugin-windows": path.join(shimDir, "hypr-plugin-windows.ts"),
      "@hypr/plugin-settings": path.join(shimDir, "hypr-plugin-settings.ts"),
      "@hypr/plugin-fs-sync": path.join(shimDir, "hypr-plugin-fs-sync.ts"),
      "@hypr/plugin-fs2": path.join(shimDir, "hypr-plugin-fs2.ts"),
      "@hypr/plugin-notify": path.join(shimDir, "hypr-plugin-notify.ts"),
      "@hypr/plugin-notification": path.join(
        shimDir,
        "hypr-plugin-notification.ts",
      ),
      "@hypr/plugin-updater2": path.join(shimDir, "hypr-plugin-updater2.ts"),
      "@hypr/plugin-analytics": path.join(shimDir, "hypr-plugin-analytics.ts"),
      "@hypr/plugin-auth": path.join(shimDir, "hypr-plugin-auth.ts"),
      "@hypr/plugin-misc": path.join(shimDir, "hypr-plugin-misc.ts"),
      "@hypr/plugin-opener2": path.join(shimDir, "hypr-plugin-opener2.ts"),
      "@hypr/plugin-transcription": path.join(
        shimDir,
        "hypr-plugin-transcription.ts",
      ),
      "@hypr/plugin-local-stt": path.join(shimDir, "hypr-plugin-local-stt.ts"),
      "@hypr/plugin-detect": path.join(shimDir, "hypr-plugin-detect.ts"),
      "@hypr/plugin-deeplink2": path.join(shimDir, "hypr-plugin-deeplink2.ts"),
    },
    dedupe: [
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/autocomplete",
      "@codemirror/language",
      "@codemirror/lint",
      "@codemirror/lang-jinja",
      "codemirror-readonly-ranges",
      "@uiw/react-codemirror",
    ],
  },
  server: {
    port: 5173,
  },
  envPrefix: ["VITE_"],
  build: {
    outDir: "./dist-browser",
    chunkSizeWarningLimit: 500 * 10,
    target: "esnext",
    minify: false,
  },
});
