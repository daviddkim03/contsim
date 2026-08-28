import { defineConfig } from 'vitest/config'

export default defineConfig({
  build: {
    // The three.js chunk is about 540 kB raw (135 kB gzipped) and is split off below; that size is expected.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        // three.js rarely changes; keeping it in its own chunk lets browsers cache it across app updates.
        codeSplitting: {
          groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ }],
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
  },
})
