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
  // Show "Follow" button near the uploader name
  showFollowButton: false,
  // Ensure at least this fraction of the source video is visible.
  // If cover-cropping would hide more than (1 - minVisibleFraction) of the video,
  // we automatically switch to object-fit: contain to reduce cropping.
  minVisibleFraction: 0.60,

  // Default language and available language playlists
  defaultLanguage: 'en',
  languages: [
    { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
    { code: 'en', label: 'English', flag: '🇺🇸' },
    { code: 'es', label: 'Español', flag: '🇪🇸' },
    { code: 'fr', label: 'Français', flag: '🇫🇷' },
    { code: 'it', label: 'Italiano', flag: '🇮🇹' },
    { code: 'ko', label: '한국어', flag: '🇰🇷' },
    { code: 'ru', label: 'Русский', flag: '🇷🇺' },
    { code: 'zh', label: '中文', flag: '🇨🇳' },
  ],
}

export type AppConfig = typeof appConfig
