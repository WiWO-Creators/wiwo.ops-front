import { devices, PlaywrightTestConfig } from '@playwright/test'
import { config as dotenvConfig } from 'dotenv'
dotenvConfig()

let maxFailures: number | undefined
if (process.env.TESTS_MAX_FAILURES !== undefined) {
  maxFailures = parseInt(process.env.TESTS_MAX_FAILURES)
}

const config: PlaywrightTestConfig = {
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'Platform',
      testIgnore: /responsive\.spec\.ts/,
      use: {
        testIdAttribute: 'data-id',
        permissions: ['clipboard-read', 'clipboard-write'],
        ...devices['Desktop Chrome'],
        screenshot: 'only-on-failure',
        viewport: {
          width: 1440,
          height: 900
        },
        trace: {
          mode: 'retain-on-failure',
          snapshots: true,
          screenshots: true,
          sources: true
        },
        contextOptions: {
          reducedMotion: 'reduce'
        }
      },
      fullyParallel: false,
      dependencies: ['setup']
    },
    {
      name: 'Responsive Android',
      testMatch: /responsive\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        testIdAttribute: 'data-id',
        permissions: ['clipboard-read', 'clipboard-write'],
        screenshot: 'only-on-failure',
        viewport: { width: 390, height: 844 },
        trace: 'retain-on-failure',
        contextOptions: { reducedMotion: 'reduce' }
      },
      fullyParallel: false,
      dependencies: ['setup']
    },
    {
      name: 'Responsive iPhone',
      testMatch: /responsive\.spec\.ts/,
      use: {
        ...devices['iPhone 13'],
        testIdAttribute: 'data-id',
        screenshot: 'only-on-failure',
        viewport: { width: 390, height: 844 },
        trace: 'retain-on-failure',
        contextOptions: { reducedMotion: 'reduce' }
      },
      fullyParallel: false,
      dependencies: ['setup']
    },
    {
      name: 'Responsive iPad',
      testMatch: /responsive\.spec\.ts/,
      use: {
        ...devices['iPad Pro 11'],
        testIdAttribute: 'data-id',
        screenshot: 'only-on-failure',
        viewport: { width: 768, height: 1024 },
        trace: 'retain-on-failure',
        contextOptions: { reducedMotion: 'reduce' }
      },
      fullyParallel: false,
      dependencies: ['setup']
    }
  ],
  retries: 2,
  timeout: 60000,
  maxFailures,
  expect: {
    timeout: 15000
  },
  globalTimeout: 1_800_000,
  reporter: [
    ['list'],
    ['html'],
    [
      'allure-playwright',
      {
        detail: true,
        suiteTitle: false
      }
    ]
  ]
}
export default config
