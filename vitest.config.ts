import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __ECHORA_VERSION__: JSON.stringify('0.1.0-test'),
    __ECHORA_BUILD_ID__: JSON.stringify('test-build'),
  },
  test: {
    environment: 'jsdom',
    restoreMocks: true,
  },
})
