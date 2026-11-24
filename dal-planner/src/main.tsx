import 'temporal-polyfill/global'
import { createRoot } from 'react-dom/client'
import { PostHogProvider } from '@posthog/react'
import './index.css'
import App from './App.tsx'

const posthogOptions = {
  // Sent through our own domain (vercel.json / vite.config.ts rewrites) so ad
  // blockers don't drop events. ui_host keeps PostHog's own links working.
  api_host: '/relay-dp',
  ui_host: 'https://us.posthog.com',
  defaults: '2026-01-30',
  cookieless_mode: 'always',
} as const

createRoot(document.getElementById('root')!).render(
  <PostHogProvider apiKey={import.meta.env.VITE_PUBLIC_POSTHOG_KEY} options={posthogOptions}>
    <App />
  </PostHogProvider>,
)
