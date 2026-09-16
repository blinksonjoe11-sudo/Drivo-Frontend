import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Capacitor already ships its own native shell for Android/iOS —
      // this only affects the web build, so it won't touch the app builds.
      includeAssets: ["icons/favicon-32.png", "icons/apple-touch-icon.png"],
      manifest: {
        name: "Drivo",
        short_name: "Drivo",
        description: "Real-time ride tracking, built on live location and geospatial search.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#101010",
        theme_color: "#00C853",
        orientation: "portrait",
        icons: [
          { src: "/icons/icon-64.png", sizes: "64x64", type: "image/png" },
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Cache the app shell so it loads offline / on flaky connections.
        // API calls (rides, auth, etc.) are left alone — they always hit the network.
        globPatterns: ["**/*.{js,css,html,png,svg,webp,woff2}"],
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
  server: {
    port: 3000,
  },
  build: {
    // ← Needed for Capacitor
    target: "esnext",
  },
});