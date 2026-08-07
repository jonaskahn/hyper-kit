import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [r('test/helpers/jsdom.ts')],
    include: ['test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // react / react-dom are provided by Hyper at runtime, not installed
      // here; tests use lightweight stubs instead.
      react: r('test/fixtures/react.ts'),
      'react-dom': r('test/fixtures/react-dom.ts'),
      // electron is provided by Hyper at runtime; onWindow() requires it in
      // the main process, tests use a shared mock instead.
      electron: r('test/fixtures/electron.ts'),
    },
  },
});
