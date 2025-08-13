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

const videoEl = ref<HTMLVideoElement | null>(null)
let hls: Hls | null = null

function teardown() {
  const el = videoEl.value
  if (!el)
    return

  if (hls) {
    hls.destroy()
    hls = null
  }
  el.removeAttribute('src')
  el.load()
}

function initHls() {
  const el = videoEl.value
  if (!el)
    return

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
}

onMounted(async () => {
  if (props.shouldLoad && !hls)
    initHls()
  if (props.shouldPlay) {
    if (hls)
      hls.startLoad()
    try {
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
