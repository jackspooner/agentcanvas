import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    exclude: ['test/e2e/**', 'test/external-plugin-fixture/**'],
    environment: 'jsdom',
    globals: true,
    restoreMocks: true
  }
});
