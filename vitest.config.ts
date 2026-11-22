import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests use the library's source, not its build.
export default defineConfig({
  resolve: { alias: { 'rar5-ts-reader': fileURLToPath(new URL('./packages/rar5-ts-reader/src/index.ts', import.meta.url)) } },
});
