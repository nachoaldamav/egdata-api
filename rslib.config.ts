import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'cjs',
      bundle: true,
      autoExternal: {
        dependencies: false,
      },
    },
  ],
  output: {
    target: 'node',
    externals: [
      "@resvg/resvg-js"
    ]
  }
});
