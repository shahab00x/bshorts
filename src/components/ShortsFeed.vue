<script setup lang="ts">
import HlsVideo from '~/components/HlsVideo.vue'
import { appConfig } from '~/config'

interface PeertubeInfo { hlsUrl: string }

interface VideoItem {
  description?: string
  uploader?: string
  duration?: number
  videoInfo?: { peertube?: PeertubeInfo }
  rawPost?: { peertube?: PeertubeInfo }
}

const items = ref<VideoItem[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const cardRefs = ref<(HTMLElement | null)[]>([])
const currentIndex = ref(0)
const paused = ref(false)
const soundOn = ref(false)
const showOverlayIcon = ref(false)
let overlayHideTimer: number | null = null

function setCardRef(el: HTMLElement | null, idx: number) {
  cardRefs.value[idx] = el
}

function getHls(item: VideoItem): string | null {
  return item.videoInfo?.peertube?.hlsUrl || item.rawPost?.peertube?.hlsUrl || null
}

function inWindow(idx: number) {
  // Render previous 1 and next N items to limit downloads
  // N is configured via appConfig.preloadAhead
  const start = Math.max(0, currentIndex.value - 1)
  const end = currentIndex.value + appConfig.preloadAhead
  return idx >= start && idx <= end
}

function shouldLoad(idx: number) {
  // Load previous 1 and next N (from appConfig.preloadAhead)
  const start = Math.max(0, currentIndex.value - 1)
  const end = currentIndex.value + appConfig.preloadAhead
  return idx >= start && idx <= end
}

function shouldPlay(idx: number) {
  return idx === currentIndex.value && !paused.value
}

function togglePlay() {
  paused.value = !paused.value
  // Show overlay icon immediately on toggle
  showOverlayIcon.value = true
  // Manage fade-out when unpausing
  if (!paused.value) {
    // user resumed playback -> enable sound globally
    soundOn.value = true
    if (overlayHideTimer)
      window.clearTimeout(overlayHideTimer)
    overlayHideTimer = window.setTimeout(() => {
      showOverlayIcon.value = false
      overlayHideTimer = null
    }, 1000)
  }
  else {
    // When paused, keep icon visible
    if (overlayHideTimer) {
      window.clearTimeout(overlayHideTimer)
      overlayHideTimer = null
    }
  }
}

function onSectionClick(idx: number) {
  if (idx === currentIndex.value)
    togglePlay()
}

function enableSound() {
  soundOn.value = true
}

async function loadPlaylist() {
  try {
    loading.value = true
    const res = await fetch('/playlists/en/latest.json', { cache: 'no-store' })
    if (!res.ok)
      throw new Error(`Failed to load playlist: ${res.status}`)
    const data = await res.json()
    items.value = (Array.isArray(data) ? data : []).filter((it: VideoItem) => !!getHls(it))
  }
  catch (e: any) {
    error.value = e?.message || String(e)
  }
  finally {
    loading.value = false
    await nextTick()
    setupObserver()
  }
}

let observer: IntersectionObserver | null = null

function setupObserver() {
  if (observer) {
    observer.disconnect()
    observer = null
  }
  observer = new IntersectionObserver((entries) => {
    // Determine the most visible item from provided entries
    let bestIdx = -1
    let bestRatio = 0
    for (const entry of entries) {
      const idxAttr = entry.target.getAttribute('data-idx')
      const idx = idxAttr ? Number(idxAttr) : -1
      if (entry.isIntersecting && entry.intersectionRatio > bestRatio) {
        bestRatio = entry.intersectionRatio
        bestIdx = idx
      }
    }

    if (bestIdx >= 0) {
      if (bestIdx !== currentIndex.value) {
        currentIndex.value = bestIdx
        // reset paused when switching items to auto-play the new one
        paused.value = false
        // hide overlay icon and clear timer on item change
        if (overlayHideTimer)
          window.clearTimeout(overlayHideTimer)
        overlayHideTimer = null
        showOverlayIcon.value = false
      }
    }
  }, { threshold: [0, 0.25, 0.5, 0.6, 0.75, 1] })

  for (let i = 0; i < cardRefs.value.length; i++) {
    const el = cardRefs.value[i]
    if (el)
      observer.observe(el)
  }
}

onMounted(() => {
  void loadPlaylist()
})

onBeforeUnmount(() => {
  if (observer)
    observer.disconnect()
})
</script>

<template>
  <div class="shorts-root">
    <div v-if="loading" class="center-msg">
      Loading…
    </div>
    <div v-else-if="error" class="center-msg text-red">
      {{ error }}
    </div>

    <div v-else class="shorts-list">
      <section
        v-for="(it, idx) in items"
        :key="idx"
        :ref="(el) => setCardRef(el as HTMLElement | null, idx)"
        class="shorts-item"
        :data-idx="idx"
        @click="onSectionClick(idx)"
      >
        <HlsVideo
          v-if="inWindow(idx)"
          :src="getHls(it)!"
          :muted="!(soundOn && idx === currentIndex && !paused)"
          :loop="true"
          :should-load="shouldLoad(idx)"
          :should-play="shouldPlay(idx)"
        />
        <div v-else class="video-placeholder" />

        <!-- Centered play/pause icon shown on user toggle -->
        <div class="overlay-center" :class="{ visible: showOverlayIcon }">
          <div class="play-icon" aria-hidden="true">
            <span v-if="paused">▶</span>
            <span v-else>❚❚</span>
          </div>
        </div>
        <!-- Tap for sound prompt (only when sound is off for the current item) -->
        <div v-if="idx === currentIndex && !soundOn" class="overlay-sound">
          <button class="sound-btn" aria-label="Tap for sound" @click.stop="enableSound">
            Tap for sound
          </button>
        </div>
        <div class="overlay">
          <div class="meta">
            <div class="uploader">
              {{ it.uploader || 'Unknown' }}
            </div>
            <div class="desc">
              {{ it.description }}
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.shorts-root {
  position: fixed;
  inset: 0;
  background: #000;
}
.center-msg {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ddd;
}
.text-red {
  color: #e57373;
}
.shorts-list {
  height: 100vh;
  overflow-y: auto;
  scroll-snap-type: y mandatory;
  overscroll-behavior-y: contain;
}
.shorts-item {
  position: relative;
  height: 100vh;
  scroll-snap-align: start;
}
.overlay {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 16px;
  color: #fff;
  background: linear-gradient(
    180deg,
    rgba(0, 0, 0, 0) 0%,
    rgba(0, 0, 0, 0.35) 60%,
    rgba(0, 0, 0, 0.65) 100%
  );
}
.overlay-center {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none; /* do not block taps */
  opacity: 0;
  transition: opacity 0.25s ease;
  transform: translateY(-8%);
}
.overlay-center.visible {
  opacity: 1;
}
.overlay-sound {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  pointer-events: none; /* allow taps to pass through except the button */
}
.sound-btn {
  pointer-events: auto;
  margin-bottom: 18vh;
  padding: 10px 16px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.6);
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-weight: 600;
}
.play-icon {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.5);
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36px;
}
.meta {
  max-width: 80ch;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}
.uploader {
  font-weight: 600;
  margin-bottom: 4px;
}
.desc {
  opacity: 0.9;
  font-size: 0.95rem;
}
.video-placeholder {
  width: 100%;
  height: 100%;
  background: #000;
}
</style>
