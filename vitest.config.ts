// Keep unit tests separate from vite.config.ts, which starts the Electron app.
export default {
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
}
