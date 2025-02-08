import { defineConfig } from "@rslib/core";

export default defineConfig({
  lib: [
    {
      format: "esm",
      bundle: true,
    },
  ],
  output: {
    target: "node",
  },
});
