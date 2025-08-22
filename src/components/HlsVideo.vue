<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Hls from 'hls.js'
import { appConfig } from '~/config'

const props = withDefaults(defineProps<{
  src: string
  muted?: boolean
  loop?: boolean
  shouldLoad?: boolean
  shouldPlay?: boolean
}>(), {
  muted: true,
  loop: false,
  shouldLoad: false,
  shouldPlay: false,
})

const emit = defineEmits<{
  (e: 'loadingChange', loading: boolean): void
  (e: 'progress', payload: { currentTime: number, duration: number }): void
  (e: 'buffered', payload: { ranges: { start: number, end: number }[], duration: number }): void
  (e: 'ended'): void
  (e: 'playbackError', payload: any): void
}>()
const videoEl = ref<HTMLVideoElement | null>(null)
let hls: Hls | null = null
const isLoading = ref(false)
// Track container and intrinsic video sizes to compute visible fraction
const containerW = ref(0)
const containerH = ref(0)
const intrinsicW = ref(0)
const intrinsicH = ref(0)
let ro: ResizeObserver | null = null
let winResizeHandler: (() => void) | null = null

function setLoading(val: boolean) {
  if (isLoading.value !== val) {
    isLoading.value = val
    emit('loadingChange', val)
  }
}

function onWaiting() {
  const el = videoEl.value
  if (!el)
    return
  // Only show spinner if we truly don't have enough data to play
  if (el.readyState < 2)
    setLoading(true)
}
function onReady() {
  setLoading(false)
}
function onTimeUpdate() {
  const el = videoEl.value
  if (!el)
    return
  // When frames are advancing and we're not actively seeking/paused, consider it ready
  if (!el.seeking && !el.paused && el.readyState >= 2)
    setLoading(false)
  // Emit playback progress on each timeupdate
  emit('progress', {
    currentTime: el.currentTime || 0,
    duration: Number.isFinite(el.duration) ? el.duration : 0,
  })
  emitBuffered()
}

function onEnded() {
  onReady()
  emit('ended')
}

function emitBuffered() {
  const el = videoEl.value
  if (!el)
    return
  const duration = Number.isFinite(el.duration) ? el.duration : 0
  const ranges: { start: number, end: number }[] = []
  const buf = el.buffered
  if (buf && buf.length) {
    for (let i = 0; i < buf.length; i++) {
      const start = buf.start(i)
      const end = buf.end(i)
      if (Number.isFinite(start) && Number.isFinite(end))
        ranges.push({ start, end })
    }
  }
  emit('buffered', { ranges, duration })
}

function onVideoElError() {
  const el = videoEl.value
  const err: any = el && (el as any).error
  try {
    emit('playbackError', {
      type: 'media',
      code: err?.code ?? null,
      message: (err && typeof err.message === 'string') ? err.message : null,
    })
  }
  catch {}
  setLoading(false)
}

function attachVideoEvents() {
  const el = videoEl.value
  if (!el)
    return
  // Intrinsic size available after metadata
  el.addEventListener('loadedmetadata', onLoadedMetadata)
  el.addEventListener('loadstart', onWaiting)
  el.addEventListener('waiting', onWaiting)
  el.addEventListener('stalled', onWaiting)
  el.addEventListener('seeking', onWaiting)
  el.addEventListener('seeked', onReady)
  el.addEventListener('loadeddata', onReady)
  el.addEventListener('canplay', onReady)
  el.addEventListener('playing', onReady)
  el.addEventListener('play', onReady)
  el.addEventListener('error', onVideoElError)
  el.addEventListener('progress', () => {
    onReady()
    emitBuffered()
  })
  el.addEventListener('ended', onEnded)
  el.addEventListener('durationchange', onReady)
  el.addEventListener('timeupdate', onTimeUpdate)
}

function detachVideoEvents() {
  const el = videoEl.value
  if (!el)
    return
  el.removeEventListener('loadedmetadata', onLoadedMetadata)
  el.removeEventListener('loadstart', onWaiting)
  el.removeEventListener('waiting', onWaiting)
  el.removeEventListener('stalled', onWaiting)
  el.removeEventListener('seeking', onWaiting)
  el.removeEventListener('seeked', onReady)
  el.removeEventListener('loadeddata', onReady)
  el.removeEventListener('canplay', onReady)
  el.removeEventListener('playing', onReady)
  el.removeEventListener('play', onReady)
  // progress had an inline listener; safe to ignore explicit removal here
  el.removeEventListener('error', onVideoElError)
  el.removeEventListener('ended', onEnded)
  el.removeEventListener('durationchange', onReady)
  el.removeEventListener('timeupdate', onTimeUpdate)
}

function teardown() {
  const el = videoEl.value
  if (!el)
    return

  // remove listeners
  detachVideoEvents()

  if (hls) {
    hls.destroy()
    hls = null
  }
  el.removeAttribute('src')
  el.load()
  setLoading(false)
}

function initHls() {
  const el = videoEl.value
  if (!el)
    return

  setLoading(true)

  if (Hls.isSupported()) {
    hls = new Hls({
      enableWorker: true,
      // VOD tuning
      lowLatencyMode: false,
      autoStartLoad: false,
      capLevelToPlayerSize: true,
      // Keep forward buffer modest to reduce data and speed up seeks
      maxBufferLength: 12,
      maxMaxBufferLength: 30,
      backBufferLength: 8,
      // Improve buffer hole handling for smoother playback
      maxBufferHole: 0.5,
      highBufferWatchdogPeriod: 2,
    })
    hls.loadSource(props.src)
    hls.attachMedia(el)
    // Bubble Hls.js errors up to parent for fallback handling
    hls.on(Hls.Events.ERROR, (_evt: any, data: any) => {
      try {
        const payload = {
          type: 'hls',
          fatal: !!data?.fatal,
          hlsType: String(data?.type || ''),
          details: String(data?.details || ''),
          data,
        }
        emit('playbackError', payload)
      }
      catch {}
    })
    // Do not autoplay here; playback driven by shouldPlay
  }
  else if (el.canPlayType('application/vnd.apple.mpegurl')) {
    // Native HLS (Safari). Only set src when we intend to load
    el.src = props.src
  }

  attachVideoEvents()
}

onMounted(async () => {
  // Observe container size changes
  const el = videoEl.value
  if (el && 'ResizeObserver' in window) {
    ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect
      if (cr) {
        containerW.value = Math.max(1, Math.floor(cr.width))
        containerH.value = Math.max(1, Math.floor(cr.height))
      }
    })
    ro.observe(el)
  }
  else if (el) {
    // Fallback: use window resize
    const updateSize = () => {
      containerW.value = Math.max(1, el.clientWidth || 0)
      containerH.value = Math.max(1, el.clientHeight || 0)
    }
    winResizeHandler = updateSize
    window.addEventListener('resize', winResizeHandler)
    updateSize()
  }

  if (props.shouldLoad && !hls)
    initHls()
  if (props.shouldPlay) {
    if (hls)
      hls.startLoad()
    try {
      setLoading(true)
      await videoEl.value?.play()
    }
    catch (err) {
      void err
    }
  }
})
onBeforeUnmount(() => {
  teardown()
  if (ro) {
    ro.disconnect()
    ro = null
  }
  if (winResizeHandler) {
    window.removeEventListener('resize', winResizeHandler)
    winResizeHandler = null
  }
})

watch(() => props.src, () => {
  // Re-initialize if currently loaded
  if (hls || (videoEl.value && videoEl.value.currentSrc)) {
    teardown()
    if (props.shouldLoad)
      initHls()
  }
})

watch(() => props.shouldLoad, (load) => {
  if (load) {
    if (!hls && !(videoEl.value?.canPlayType('application/vnd.apple.mpegurl') && videoEl.value?.currentSrc))
      initHls()
    setLoading(true)
  }
  else {
    // Stop downloads and release element when we no longer need it
    if (hls)
      hls.stopLoad()
    teardown()
  }
})

watch(() => props.shouldPlay, async (play) => {
  const el = videoEl.value
  if (!el)
    return
  if (play) {
    if (!hls && props.shouldLoad)
      initHls()
    if (hls)
      hls.startLoad()
    try {
      setLoading(true)
      await el.play()
    }
    catch (err) {
      // ignore autoplay errors (gesture required etc.)
      void err
    }
  }
  else {
    el.pause()
    if (hls)
      hls.stopLoad()
  }
}, { immediate: true })

function play() {
  if (hls)
    hls.startLoad()
  videoEl.value?.play()
}
function pause() {
  videoEl.value?.pause()
}
function mute() {
  if (videoEl.value)
    videoEl.value.muted = true
}
function unmute() {
  if (videoEl.value)
    videoEl.value.muted = false
}

function seekTo(seconds: number) {
  const el = videoEl.value
  if (!el)
    return
  const duration = Number.isFinite(el.duration) ? el.duration : 0
  const t = Math.max(0, Math.min(seconds, duration || Number.MAX_SAFE_INTEGER))
  el.currentTime = t
}

// Expose controls to parent
defineExpose({ play, pause, mute, unmute, seekTo, el: videoEl })

// ----- Visible fraction and object-fit selection -----
function onLoadedMetadata() {
  const el = videoEl.value
  if (!el)
    return
  intrinsicW.value = Math.max(1, el.videoWidth || 0)
  intrinsicH.value = Math.max(1, el.videoHeight || 0)
}

const containerAR = computed(() => containerW.value / Math.max(1, containerH.value))
const videoAR = computed(() => intrinsicW.value / Math.max(1, intrinsicH.value))
// Under object-fit: cover, the visible area fraction equals min(containerAR/videoAR, videoAR/containerAR)
const coverVisibleFraction = computed(() => {
  const car = containerAR.value
  const varr = videoAR.value
  if (!Number.isFinite(car) || !Number.isFinite(varr) || car <= 0 || varr <= 0)
    return 1
  const r = car / varr
  return Math.min(r, 1 / r)
})
const objectFitMode = computed(() => coverVisibleFraction.value < appConfig.minVisibleFraction ? 'contain' : 'cover')
</script>

<template>
  <video
    ref="videoEl"
    :muted="muted"
    :loop="loop"
    playsinline
    preload="none"
    :style="{ width: '100%', height: '100%', objectFit: objectFitMode, background: '#000' }"
  />
</template>

<style scoped>
</style>
