// Global app configuration
// Adjust values here without touching component code.

export const appConfig = {
  // Number of videos ahead of the current one to render/load.
  // Example: 3 means current + next 3 will be rendered and preloaded.
  preloadAhead: 1,
  // Show performance overlay (FPS, buffer, stalls) for current video
  debugPerfOverlay: true,
  // Use TikTok-like pager (one page per view, swipe/wheel to change)
  pagerMode: true,
}

export type AppConfig = typeof appConfig
