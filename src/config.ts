// Global app configuration
// Adjust values here without touching component code.

export const appConfig = {
  // Number of videos ahead of the current one to render/load.
  // Example: 3 means current + next 3 will be rendered and preloaded.
  preloadAhead: 3,
  // Show performance overlay (FPS, buffer, stalls) for current video
  debugPerfOverlay: false,
  // Use TikTok-like pager (one page per view, swipe/wheel to change)
  pagerMode: true,
  // Hide content when total moderation flags on the post reach this number.
  // If total flags are between 1 and (flagsHideThreshold - 1), show a
  // "Sensitive content" overlay with a "Watch anyway" button.
  // Set to a high value to be conservative; set to 0 to disable hiding entirely.
  flagsHideThreshold: 3,
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

  // Optional: configure feedback destination used by Settings drawer
  // If feedbackUrl is set, clicking "Send feedback" opens this URL via the SDK.
  // Otherwise, a mailto: link is used with feedbackMailTo (or support@bastyon.com fallback).
  feedbackUrl: '',
  feedbackMailTo: '',
  // Optional: developer profile URL for the settings drawer footer
  developerProfileUrl: 'https://bastyon.com/shahab',
}

export type AppConfig = typeof appConfig
