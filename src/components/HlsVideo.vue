<script setup lang="ts">
import Hls from 'hls.js'

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

const emit = defineEmits<{ (e: 'loadingChange', loading: boolean): void }>()
const videoEl = ref<HTMLVideoElement | null>(null)
let hls: Hls | null = null
const isLoading = ref(false)

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
}

function attachVideoEvents() {
  const el = videoEl.value
  if (!el)
    return
  el.addEventListener('loadstart', onWaiting)
  el.addEventListener('waiting', onWaiting)
  el.addEventListener('stalled', onWaiting)
  el.addEventListener('seeking', onWaiting)
  el.addEventListener('seeked', onReady)
  el.addEventListener('loadeddata', onReady)
  el.addEventListener('canplay', onReady)
  el.addEventListener('playing', onReady)
  el.addEventListener('play', onReady)
  el.addEventListener('progress', onReady)
  el.addEventListener('ended', onReady)
  el.addEventListener('durationchange', onReady)
  el.addEventListener('timeupdate', onTimeUpdate)
}

function detachVideoEvents() {
  const el = videoEl.value
  if (!el)
    return
  el.removeEventListener('loadstart', onWaiting)
  el.removeEventListener('waiting', onWaiting)
  el.removeEventListener('stalled', onWaiting)
  el.removeEventListener('seeking', onWaiting)
  el.removeEventListener('seeked', onReady)
  el.removeEventListener('loadeddata', onReady)
  el.removeEventListener('canplay', onReady)
  el.removeEventListener('playing', onReady)
  el.removeEventListener('play', onReady)
  el.removeEventListener('progress', onReady)
  el.removeEventListener('ended', onReady)
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
      maxBufferLength: 10,
      backBufferLength: 30,
    })
    hls.loadSource(props.src)
    hls.attachMedia(el)
    // Do not autoplay here; playback driven by shouldPlay
  }
  else if (el.canPlayType('application/vnd.apple.mpegurl')) {
    // Native HLS (Safari). Only set src when we intend to load
    el.src = props.src
  }

  attachVideoEvents()
}

onMounted(async () => {
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

// Expose controls to parent
defineExpose({ play, pause, mute, unmute, el: videoEl })
</script>

<template>
  <video
    ref="videoEl"
    :muted="muted"
    :loop="loop"
    playsinline
    preload="none"
    style="width:100%;height:100%;object-fit:cover;background:#000;"
  />
</template>

<style scoped>
</style>
