import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Date helpers read the local clock. Pin the zone so a test gives the same
// answer on a laptop in Singapore and on a CI runner in UTC.
process.env.TZ = "Asia/Singapore";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
