import { defineConfig, devices } from '@playwright/test';

/**
 * CI runners have no GPU. Chromium's default GL path there draws one map frame in
 * over a second, and ANGLE's SwiftShader backend draws it within a frame at 60 Hz.
 */
export const SOFTWARE_GL = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] as const;

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env['CI'],
  // Each Chromium draws with SwiftShader on the CPU. Two at once on a 2-core pylon were
  // not clearly faster (3.8 against 4.5 minutes) and starved a page for over 5 s.
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
    ...(process.env['CI'] ? [['github'] as const] : []),
  ],
  use: {
    baseURL: 'http://localhost:4173',
    // Every page a test opens draws the test drawing of src/render/draw-options.ts.
    // A page opened with ?draw=full draws everything, as the game and the captures do.
    storageState: {
      cookies: [],
      origins: [
        { origin: 'http://localhost:4173', localStorage: [{ name: 'draw', value: 'test' }] },
      ],
    },
    trace: 'retain-on-failure',
    launchOptions: { args: [...SOFTWARE_GL] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
  },
});
