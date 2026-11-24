import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'
import posthog from '@posthog/rollup-plugin'

// Path PostHog traffic is proxied through (see vercel.json). A neutral name so
// ad blockers' filter lists don't match it.
const POSTHOG_PROXY_PATH = '/relay-dp'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') }

  // Upload source maps to PostHog error tracking at build time, so exception
  // stack traces point at real source instead of minified bundles. Only when
  // a personal API key is configured (set it in Vercel); local and CI builds
  // without one skip the upload entirely.
  const sourcemapUpload = env.POSTHOG_PERSONAL_API_KEY && env.POSTHOG_PROJECT_ID
    ? [posthog({
        personalApiKey: env.POSTHOG_PERSONAL_API_KEY,
        projectId: env.POSTHOG_PROJECT_ID,
        host: env.POSTHOG_CLI_HOST || 'https://us.posthog.com',
        sourcemaps: {
          enabled: true,
          releaseName: 'dal-planner',
          releaseVersion: env.VERCEL_GIT_COMMIT_SHA || undefined,
          // Maps are uploaded, then removed so they are never served publicly
          deleteAfterUpload: true,
        },
      })]
    : []

  return {
    plugins: [react(), ...sourcemapUpload],
    server: {
      // Mirror the Vercel rewrites in local dev
      proxy: {
        [`${POSTHOG_PROXY_PATH}/static`]: {
          target: 'https://us-assets.i.posthog.com',
          changeOrigin: true,
          rewrite: p => p.replace(POSTHOG_PROXY_PATH, ''),
        },
        [`${POSTHOG_PROXY_PATH}/array`]: {
          target: 'https://us-assets.i.posthog.com',
          changeOrigin: true,
          rewrite: p => p.replace(POSTHOG_PROXY_PATH, ''),
        },
        [POSTHOG_PROXY_PATH]: {
          target: 'https://us.i.posthog.com',
          changeOrigin: true,
          rewrite: p => p.replace(POSTHOG_PROXY_PATH, ''),
        },
      },
    },
  }
})
