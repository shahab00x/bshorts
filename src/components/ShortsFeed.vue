<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
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

// Drawer state
const showDescriptionDrawer = ref(false)
const showCommentsDrawer = ref(false)

// Current item helpers
const currentItem = computed(() => items.value[currentIndex.value] || null)

function getCaption(it: any): string {
  return (
    it?.rawPost?.caption
    ?? it?.rawPost?.title
    ?? it?.caption
    ?? it?.title
    ?? ''
  )
}
function getDescription(it: any): string {
  return (
    it?.rawPost?.description
    ?? it?.description
    ?? ''
  )
}
function parseHashtags(val: any): string[] {
  if (!val)
    return []
  // Some playlists store hashtags as a JSON-encoded string
  try {
    if (typeof val === 'string') {
      const trimmed = val.trim()
      if (trimmed.startsWith('[')) {
        const arr = JSON.parse(trimmed)
        return Array.isArray(arr) ? arr.map((s: any) => String(s)) : []
      }
      // Fallback: comma or space separated
      return trimmed
        .replace(/^[#\s]+/, '')
        .split(/[\s,]+/)
        .filter(Boolean)
    }
    if (Array.isArray(val))
      return val.map(v => String(v))
  }
  catch {
    // ignore
  }
  return []
}

// Minimal HTML escaper + linkifier (URLs -> <a>)
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
function linkify(s: string): string {
  const escaped = escapeHtml(s)
  // Line breaks to <br>
  const withBreaks = escaped.replace(/\n/g, '<br/>')
  // URL regex (simple)
  const urlRe = /(https?:\/\/[^\s<]+)/gi
  return withBreaks.replace(urlRe, m => `<a href="${m}" target="_blank" rel="noopener nofollow">${m}</a>`)
}

const descCaption = computed(() => getCaption(currentItem.value))
const descText = computed(() => getDescription(currentItem.value))
const descHtml = computed(() => linkify(descText.value || ''))
const descTags = computed(() => parseHashtags(currentItem.value?.rawPost?.hashtags ?? (currentItem.value as any)?.hashtags))

const commentsCount = computed(() => {
  const c = (currentItem.value as any)?.comments ?? (currentItem.value as any)?.rawPost?.comments
  const n = Number(c)
  return Number.isFinite(n) && n >= 0 ? n : 0
})
const commentsHeightPct = computed(() => {
  const n = commentsCount.value
  // Grow with comment volume, cap at ~66.67vh
  if (n >= 100)
    return 66.6667
  if (n >= 50)
    return 60
  if (n >= 20)
    return 56
  if (n >= 5)
    return 46
  return 36 // minimum feel for empty/few comments
})

function toggleCommentsDrawer(ev?: Event) {
  ev?.stopPropagation?.()
  showCommentsDrawer.value = !showCommentsDrawer.value
  if (showCommentsDrawer.value)
    showDescriptionDrawer.value = false
}
function openDescriptionDrawer(ev?: Event) {
  ev?.stopPropagation?.()
  showDescriptionDrawer.value = true
  showCommentsDrawer.value = false
}
function closeAnyDrawer() {
  showDescriptionDrawer.value = false
  showCommentsDrawer.value = false
}

// Pager container + navigation state
const pagerRef = ref<HTMLElement | null>(null)
const isPaging = ref(false)
let lastNavAt = 0
let touchStartY = 0
let touchStartTime = 0

// Pager-mode window derived from current index
const visibleStart = computed(() => Math.max(0, currentIndex.value - 1))
const visibleEnd = computed(() => Math.min(items.value.length - 1, currentIndex.value + appConfig.preloadAhead))
const visibleIndices = computed(() =>
  Array.from({ length: Math.max(0, visibleEnd.value - visibleStart.value + 1) }, (_, i) => visibleStart.value + i),
)
const visibleItems = computed(() => visibleIndices.value.map(idx => ({ idx, item: items.value[idx] })))

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
  // Keep refs for potential future use (e.g., focus management)
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
    // Focus pager for keyboard navigation once content is ready
    pagerRef.value?.focus()
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

// Pager navigation helpers
function resetOnPageChange() {
  // reset paused when switching items to auto-play the new one
  paused.value = false
  if (overlayHideTimer)
    window.clearTimeout(overlayHideTimer)
  overlayHideTimer = null
  showOverlayIcon.value = false
}
function goToIndex(next: number) {
  if (next < 0 || next >= items.value.length || next === currentIndex.value)
    return
  currentIndex.value = next
  resetOnPageChange()
}
function nextPage() {
  goToIndex(currentIndex.value + 1)
}
function prevPage() {
  goToIndex(currentIndex.value - 1)
}
function onWheel(ev: WheelEvent) {
  // Prevent underlying scroll (host app)
  ev.preventDefault()
  if (isPaging.value)
    return
  const now = performance.now()
  if (now - lastNavAt < 300)
    return
  if (ev.deltaY > 20)
    nextPage()
  else if (ev.deltaY < -20)
    prevPage()
  lastNavAt = now
  isPaging.value = true
  window.setTimeout(() => {
    isPaging.value = false
  }, 220)
}
function onTouchStart(ev: TouchEvent) {
  if (ev.touches.length > 0) {
    touchStartY = ev.touches[0].clientY
    touchStartTime = performance.now()
  }
}
function onTouchEnd(ev: TouchEvent) {
  const touch = ev.changedTouches[0]
  if (!touch)
    return
  const dy = touch.clientY - touchStartY
  const dt = performance.now() - touchStartTime
  if (Math.abs(dy) > 50 && dt < 800) {
    if (dy < 0)
      nextPage()
    else
      prevPage()
  }
}
function onKeyDown(ev: KeyboardEvent) {
  if (ev.key === 'ArrowDown' || ev.key === 'PageDown') {
    ev.preventDefault()
    nextPage()
  }
  else if (ev.key === 'ArrowUp' || ev.key === 'PageUp') {
    ev.preventDefault()
    prevPage()
  }
  else if (ev.key === 'Escape') {
    ev.preventDefault()
    closeAnyDrawer()
  }
}

onMounted(() => {
  void loadPlaylist()
})

onBeforeUnmount(() => {
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

    <div
      v-else
      ref="pagerRef"
      class="pager-root"
      tabindex="0"
      @wheel="onWheel"
      @touchstart.passive="onTouchStart"
      @touchend.passive="onTouchEnd"
      @keydown="onKeyDown"
    >
      <section
        v-for="vi in visibleItems"
        :key="vi.idx"
        :ref="(el) => setCardRef(el as HTMLElement | null, vi.idx)"
        class="pager-item"
        :class="{ 'is-current': vi.idx === currentIndex, 'is-prev': vi.idx < currentIndex, 'is-next': vi.idx > currentIndex }"
        :data-idx="vi.idx"
        @click="onSectionClick(vi.idx)"
      >
        <HlsVideo
          v-if="inWindow(vi.idx)"
          :ref="(el) => setVideoRef(el, vi.idx)"
          :src="getHls(vi.item)!"
          :loop="true"
          :muted="!(soundOn && vi.idx === currentIndex && !paused)"
          :should-load="shouldLoad(vi.idx)"
          :should-play="shouldPlay(vi.idx)"
          @loading-change="onVideoLoadingChange(vi.idx, $event)"
          @progress="onVideoProgress(vi.idx, $event)"
          @buffered="onVideoBuffered(vi.idx, $event)"
        />
        <div v-else class="video-placeholder" />

        <!-- Debug performance overlay -->
        <PerfOverlay
          v-if="appConfig.debugPerfOverlay && vi.idx === currentIndex"
          :video-el="videoRefs[vi.idx]?.el ?? null"
          :is-current="vi.idx === currentIndex"
        />

        <!-- Centered play/pause icon shown on user toggle -->
        <div class="overlay-center" :class="{ visible: showOverlayIcon }">
          <div class="play-icon" aria-hidden="true">
            <span v-if="paused">▶</span>
            <span v-else>❚❚</span>
          </div>
        </div>
        <!-- Loading spinner while video is loading/buffering -->
        <div v-if="inWindow(vi.idx) && videoLoading[vi.idx]" class="overlay-loading">
          <LoadingSpinner :size="72" pad="14%" aria-label="Loading video" />
        </div>
        <!-- Tap for sound prompt (only when sound is off for the current item) -->
        <div v-if="vi.idx === currentIndex && !soundOn" class="overlay-sound">
          <button class="sound-btn" aria-label="Tap for sound" @click.stop="enableSound">
            Tap for sound
          </button>
        </div>
        <div class="overlay">
          <div class="meta">
            <div class="uploader">
              {{ vi.item.uploader || 'Unknown' }}
            </div>
            <div class="desc" title="View description" @click.stop="openDescriptionDrawer">
              {{ vi.item.description }}
            </div>
          </div>
          <div class="seekbar">
            <div
              class="seekbar-track"
              @click.stop.prevent="onSeekClick(vi.idx, $event)"
              @pointerdown="onSeekPointerDown(vi.idx, $event)"
              @mousemove="onTrackHoverMove(vi.idx, $event)"
              @mouseleave="onTrackHoverLeave"
            >
              <div
                v-for="(r, rIdx) in (buffered[vi.idx]?.ranges || [])"
                :key="rIdx"
                class="buffer-segment"
                :style="{
                  left: buffered[vi.idx]?.duration
                    ? `${((r.start / buffered[vi.idx].duration) * 100).toFixed(2)}%`
                    : '0%',
                  width: buffered[vi.idx]?.duration
                    ? `${(((r.end - r.start) / buffered[vi.idx].duration) * 100).toFixed(2)}%`
                    : '0%',
                }"
              />
              <div
                class="seekbar-fill"
                :style="{
                  width: `${(
                    progress[vi.idx]?.duration
                      ? ((isScrubbing && scrubIdx === vi.idx)
                        ? (scrubPct * 100)
                        : Math.min(100, Math.max(0, (progress[vi.idx].currentTime / progress[vi.idx].duration) * 100)))
                      : 0
                  ).toFixed(2)}%`,
                }"
              />
              <div
                v-if="isScrubbing && scrubIdx === vi.idx"
                class="seekbar-thumb"
                :style="{
                  left: `${(scrubPct * 100).toFixed(2)}%`,
                }"
              />
              <div
                v-if="showTooltip && tooltipIdx === vi.idx"
                class="seekbar-tooltip"
                :style="{ left: `${(tooltipPct * 100).toFixed(2)}%` }"
              >
                {{ formatTime((progress[vi.idx]?.duration || buffered[vi.idx]?.duration || 0) * tooltipPct) }}
              </div>
            </div>
          </div>
        </div>
        <!-- Right-side controls -->
        <div v-if="vi.idx === currentIndex" class="right-controls">
          <button class="comments-btn" aria-label="Open comments" @click.stop="toggleCommentsDrawer">
            💬
            <span v-if="commentsCount" class="comments-badge">{{ commentsCount }}</span>
          </button>
        </div>
      </section>
    </div>
    <!-- Screen tint overlay when any drawer is open -->
    <div class="screen-tint" :class="{ visible: showDescriptionDrawer || showCommentsDrawer }" @click="closeAnyDrawer" />

    <!-- Description Drawer (right side) -->
    <div class="drawer-base description-drawer" :class="{ open: showDescriptionDrawer }" @click.self="closeAnyDrawer">
      <div class="drawer-content" @click.stop>
        <div class="drawer-header">
          <h3>Description</h3>
        </div>
        <div class="drawer-body">
          <template v-if="descCaption">
            <h4 class="desc-title">
              {{ descCaption }}
            </h4>
          </template>
          <div class="desc-text" v-html="descHtml" />
          <div v-if="descTags.length" class="hashtags-row">
            <a
              v-for="(tag, i) in descTags"
              :key="i"
              class="hashtag"
              :href="`https://bastyon.com/index?sst=${encodeURIComponent(tag)}`"
              target="_blank"
              rel="noopener"
            >#{{ tag }}</a>
          </div>
        </div>
      </div>
    </div>

    <!-- Comments Drawer (right side) -->
    <div
      class="drawer-base comments-drawer"
      :class="{ open: showCommentsDrawer }"
      :style="{ '--comments-height': `${commentsHeightPct}vh` }"
      @click.self="closeAnyDrawer"
    >
      <div class="drawer-content" @click.stop>
        <div class="drawer-header">
          <h3>Comments</h3>
        </div>
        <div class="drawer-body">
          <div v-if="commentsCount === 0" class="no-comments">
            No comments yet
          </div>
          <!-- Integrate comments list here when backend is ready -->
        </div>
      </div>
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
  height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ddd;
}
.text-red {
  color: #e57373;
}
.pager-root {
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  touch-action: pan-x; /* allow vertical swipes to be handled */
}
.pager-item {
  position: absolute;
  inset: 0;
  height: 100vh;
  height: 100dvh;
  /* Promote to its own layer for smoother animations */
  will-change: transform;
  transform: translateZ(0);
  contain: content;
  backface-visibility: hidden;
  transition: transform 220ms ease;
}
.pager-item.is-current {
  transform: translateY(0%);
}
.pager-item.is-prev {
  transform: translateY(-100%);
}
.pager-item.is-next {
  transform: translateY(100%);
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
  margin-bottom: 18dvh;
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
  cursor: pointer;
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
.spacer {
  width: 100%;
}

/* Right-side controls */
.right-controls {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 12px;
  z-index: 8;
}
.comments-btn {
  position: relative;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.5);
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.comments-btn .comments-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: #ff5252;
  color: #fff;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
}

/* Screen tint */
.screen-tint {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  opacity: 0;
  pointer-events: none;
  transition: opacity 200ms ease;
  z-index: 9;
}
.screen-tint.visible {
  opacity: 1;
  pointer-events: auto;
}

/* Drawers */
.drawer-base {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100vw;
  transform: translateY(100%);
  transition: transform 240ms ease;
  z-index: 10;
  display: flex;
  flex-direction: column;
}
.drawer-base.open {
  transform: translateY(0%);
}
.drawer-content {
  width: 100%;
  height: 100%;
  background: rgba(16, 16, 16, 0.98);
  color: #fff;
  display: flex;
  flex-direction: column;
}
.drawer-header {
  position: sticky;
  top: 0;
  background: rgba(16, 16, 16, 1);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding: 12px 16px;
  z-index: 1;
}
.drawer-header h3 {
  margin: 0;
  font-size: 16px;
}
.drawer-body {
  padding: 12px 16px 16px 16px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.drawer-body a {
  color: #6ec1ff;
  text-decoration: underline;
}

/* Description bottom sheet: min 1/4, max 1/2 viewport height */
.description-drawer {
  height: clamp(25vh, 40vh, 50vh);
}
.desc-title {
  margin: 0 0 8px 0;
  font-size: 18px;
  font-weight: 600;
}
.desc-text {
  line-height: 1.4;
}
.hashtags-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.hashtags-row .hashtag {
  color: #9bd1ff;
  text-decoration: none;
  background: rgba(110, 193, 255, 0.12);
  border: 1px solid rgba(110, 193, 255, 0.25);
  padding: 2px 8px;
  border-radius: 999px;
}

/* Comments bottom sheet: up to 2/3 viewport height, dynamic */
.comments-drawer {
  height: min(var(--comments-height, 50vh), 66.6667vh);
}
.no-comments {
  opacity: 0.8;
}
</style>
