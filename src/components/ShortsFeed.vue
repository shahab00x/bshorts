<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import HlsVideo from '~/components/HlsVideo.vue'
import PerfOverlay from '~/components/PerfOverlay.vue'
import LoadingSpinner from '~/components/LoadingSpinner.vue'
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
const videoRefs = ref<any[]>([])
const currentIndex = ref(0)
const paused = ref(false)
const soundOn = ref(false)
const showOverlayIcon = ref(false)
let overlayHideTimer: number | null = null
const videoLoading = ref<boolean[]>([])
const progress = ref<{ currentTime: number, duration: number }[]>([])
const buffered = ref<{ ranges: { start: number, end: number }[], duration: number }[]>([])
// Scrubbing & tooltip state
const isScrubbing = ref(false)
const scrubIdx = ref<number | null>(null)
const scrubPct = ref(0)
const scrubRect = ref<DOMRect | null>(null)
const showTooltip = ref(false)
const tooltipIdx = ref<number | null>(null)
const tooltipPct = ref(0)

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}
function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0)
    sec = 0
  const s = Math.floor(sec % 60)
  const m = Math.floor((sec / 60) % 60)
  const h = Math.floor(sec / 3600)
  if (h > 0)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function setCardRef(el: HTMLElement | null, idx: number) {
  cardRefs.value[idx] = el
}

function setVideoRef(el: any, idx: number) {
  videoRefs.value[idx] = el
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
    videoLoading.value = items.value.map(() => false)
    progress.value = items.value.map(() => ({ currentTime: 0, duration: 0 }))
    buffered.value = items.value.map(() => ({ ranges: [], duration: 0 }))
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

function onVideoLoadingChange(idx: number, isLoading: boolean) {
  videoLoading.value[idx] = isLoading
}

function onVideoProgress(idx: number, payload: { currentTime: number, duration: number }) {
  progress.value[idx] = payload
}

function onVideoBuffered(idx: number, payload: { ranges: { start: number, end: number }[], duration: number }) {
  buffered.value[idx] = payload
}

function onSeekClick(idx: number, ev: MouseEvent) {
  ev.stopPropagation()
  ev.preventDefault()
  const target = ev.currentTarget as HTMLElement | null
  if (!target)
    return
  const rect = target.getBoundingClientRect()
  const x = ev.clientX - rect.left
  const pct = Math.max(0, Math.min(1, x / rect.width))
  const dur = progress.value[idx]?.duration || buffered.value[idx]?.duration || 0
  if (dur > 0) {
    const t = pct * dur
    videoRefs.value[idx]?.seekTo?.(t)
  }
}

function onSeekPointerDown(idx: number, ev: PointerEvent) {
  ev.stopPropagation()
  ev.preventDefault()
  const target = ev.currentTarget as HTMLElement | null
  if (!target)
    return
  const rect = target.getBoundingClientRect()
  scrubRect.value = rect
  scrubIdx.value = idx
  isScrubbing.value = true
  target.setPointerCapture?.(ev.pointerId)
  // initial update
  onWindowPointerMove(ev)
  window.addEventListener('pointermove', onWindowPointerMove)
  window.addEventListener('pointerup', onWindowPointerUp, { once: true })
  window.addEventListener('pointercancel', onWindowPointerUp, { once: true })
}

function updateTooltip(idx: number, pct: number) {
  tooltipIdx.value = idx
  tooltipPct.value = clamp01(pct)
  showTooltip.value = true
}
function onTrackHoverMove(idx: number, ev: MouseEvent) {
  const target = ev.currentTarget as HTMLElement | null
  if (!target || isScrubbing.value)
    return
  const rect = target.getBoundingClientRect()
  const pct = clamp01((ev.clientX - rect.left) / rect.width)
  updateTooltip(idx, pct)
}
function onTrackHoverLeave() {
  if (isScrubbing.value)
    return
  showTooltip.value = false
  tooltipIdx.value = null
}
function onWindowPointerMove(ev: PointerEvent) {
  if (!isScrubbing.value || scrubIdx.value == null || !scrubRect.value)
    return
  const pct = clamp01((ev.clientX - scrubRect.value.left) / scrubRect.value.width)
  scrubPct.value = pct
  updateTooltip(scrubIdx.value, pct)
  const idx = scrubIdx.value
  const dur = progress.value[idx]?.duration || buffered.value[idx]?.duration || 0
  if (dur > 0)
    videoRefs.value[idx]?.seekTo?.(pct * dur)
}
function onWindowPointerUp() {
  isScrubbing.value = false
  scrubIdx.value = null
  scrubRect.value = null
  window.removeEventListener('pointermove', onWindowPointerMove)
  // keep tooltip if hovering; otherwise it will be hidden by mouseleave
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
  }, { threshold: [0, 0.25, 0.5, 0.6, 0.75, 1], rootMargin: '200px 0px' })

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
  // Safety: remove pointer listeners if scrubbing during unmount
  window.removeEventListener('pointermove', onWindowPointerMove)
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
          :ref="(el) => setVideoRef(el, idx)"
          :src="getHls(it)!"
          :loop="true"
          :muted="!(soundOn && idx === currentIndex && !paused)"
          :should-load="shouldLoad(idx)"
          :should-play="shouldPlay(idx)"
          @loading-change="onVideoLoadingChange(idx, $event)"
          @progress="onVideoProgress(idx, $event)"
          @buffered="onVideoBuffered(idx, $event)"
        />
        <div v-else class="video-placeholder" />

        <!-- Debug performance overlay -->
        <PerfOverlay
          v-if="appConfig.debugPerfOverlay && idx === currentIndex"
          :video-el="videoRefs[idx]?.el ?? null"
          :is-current="idx === currentIndex"
        />

        <!-- Centered play/pause icon shown on user toggle -->
        <div class="overlay-center" :class="{ visible: showOverlayIcon }">
          <div class="play-icon" aria-hidden="true">
            <span v-if="paused">▶</span>
            <span v-else>❚❚</span>
          </div>
        </div>
        <!-- Loading spinner while video is loading/buffering -->
        <div v-if="inWindow(idx) && videoLoading[idx]" class="overlay-loading">
          <LoadingSpinner :size="72" pad="14%" aria-label="Loading video" />
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
          <div class="seekbar">
            <div
              class="seekbar-track"
              @click.stop.prevent="onSeekClick(idx, $event)"
              @pointerdown="onSeekPointerDown(idx, $event)"
              @mousemove="onTrackHoverMove(idx, $event)"
              @mouseleave="onTrackHoverLeave"
            >
              <div
                v-for="(r, rIdx) in (buffered[idx]?.ranges || [])"
                :key="rIdx"
                class="buffer-segment"
                :style="{
                  left: buffered[idx]?.duration
                    ? `${((r.start / buffered[idx].duration) * 100).toFixed(2)}%`
                    : '0%',
                  width: buffered[idx]?.duration
                    ? `${(((r.end - r.start) / buffered[idx].duration) * 100).toFixed(2)}%`
                    : '0%',
                }"
              />
              <div
                class="seekbar-fill"
                :style="{
                  width: `${(
                    progress[idx]?.duration
                      ? ((isScrubbing && scrubIdx === idx)
                        ? (scrubPct * 100)
                        : Math.min(100, Math.max(0, (progress[idx].currentTime / progress[idx].duration) * 100)))
                      : 0
                  ).toFixed(2)}%`,
                }"
              />
              <div
                v-if="isScrubbing && scrubIdx === idx"
                class="seekbar-thumb"
                :style="{
                  left: `${(scrubPct * 100).toFixed(2)}%`,
                }"
              />
              <div
                v-if="showTooltip && tooltipIdx === idx"
                class="seekbar-tooltip"
                :style="{ left: `${(tooltipPct * 100).toFixed(2)}%` }"
              >
                {{ formatTime((progress[idx]?.duration || buffered[idx]?.duration || 0) * tooltipPct) }}
              </div>
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
  /* Promote to its own layer for smoother scrolling */
  will-change: transform;
  transform: translateZ(0);
  contain: content;
  backface-visibility: hidden;
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
.overlay-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none; /* do not block taps */
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
.seekbar {
  margin-top: 8px;
  position: relative;
  left: -16px; /* extend beyond overlay horizontal padding */
  width: calc(100% + 32px);
}
.seekbar-track {
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.25);
  border-radius: 999px;
  overflow: visible; /* allow tooltip/thumb to render outside */
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  position: relative;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
}
.buffer-segment {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(
    110,
    193,
    255,
    0.4
  ); /* translucent light blue for buffered */
}
.seekbar-fill {
  position: relative;
  height: 100%;
  background: #6ec1ff; /* light blue */
  transition: width 120ms linear;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.06) inset;
}
/* Drag handle */
.seekbar-thumb {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #6ec1ff;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.3);
  pointer-events: none; /* track handles pointer events */
  z-index: 2;
}
.seekbar-tooltip {
  position: absolute;
  bottom: 100%;
  transform: translateX(-50%);
  margin-bottom: 6px;
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 3;
}
.seekbar-tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 6px solid transparent;
  border-top-color: rgba(0, 0, 0, 0.8);
}
.video-placeholder {
  width: 100%;
  height: 100%;
  background: #000;
}
</style>
