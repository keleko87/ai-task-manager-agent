import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "src/workout-schema.ts",
        "src/storage/workout-store.ts",
        "src/tools/save-workout.ts",
        "src/workout-save-approval.ts",
      ],
      exclude: ["src/**/*.test.ts"],
    },
  },
});