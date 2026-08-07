import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // react / react-dom are provided by Hyper at runtime, not installed
      // here; tests use lightweight stubs instead.
      react: r('test/fixtures/react.ts'),
      'react-dom': r('test/fixtures/react-dom.ts'),
    },
  },
});
