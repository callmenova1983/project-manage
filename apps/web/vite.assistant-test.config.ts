import { defineConfig } from "vite";
import base from "./vite.config";

// Assistant browser tests use demo storage or their own in-memory API fixture.
// Deliberately omit the normal /api proxy so an unrouted request cannot touch
// the user's workspace on port 3001.
export default defineConfig({
  ...base,
  server: { host: "127.0.0.1", port: 4185, strictPort: true },
});
