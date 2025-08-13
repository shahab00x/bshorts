<script setup lang="ts">
const props = defineProps<{
  videoEl: HTMLVideoElement | null
  isCurrent?: boolean
}>()

const fps = ref(0)
const bufferedSec = ref(0)
const dropped = ref<number | null>(null)
const total = ref<number | null>(null)
const stalls = ref(0)
const readyState = ref<number | null>(null)
let rafId: number | null = null
let lastTs = 0
let frames = 0
let lastFpsUpdate = 0

function onWaiting() {
  stalls.value += 1
}
function onStalled() {
  stalls.value += 1
}

function attach(el: HTMLVideoElement | null) {
  if (!el)
    return
  el.addEventListener('waiting', onWaiting)
  el.addEventListener('stalled', onStalled)
}
function detach(el: HTMLVideoElement | null) {
  if (!el)
    return
  el.removeEventListener('waiting', onWaiting)
  el.removeEventListener('stalled', onStalled)
}

watch(() => props.videoEl, (newEl, oldEl) => {
  if (oldEl !== newEl) {
    detach(oldEl)
    attach(newEl)
  }
})

function tick(ts: number) {
  if (!lastTs)
    lastTs = ts
  frames++
  // update FPS every ~500ms
  if (ts - lastFpsUpdate >= 500) {
    const delta = ts - lastTs
    fps.value = Math.round((frames / delta) * 1000)
    frames = 0
    lastTs = ts
    lastFpsUpdate = ts
  }

  const el = props.videoEl
  if (el) {
    readyState.value = el.readyState
    // buffered seconds ahead
    try {
      if (el.buffered && el.buffered.length) {
        const end = el.buffered.end(el.buffered.length - 1)
        bufferedSec.value = Math.max(0, end - el.currentTime)
      }
      else {
        bufferedSec.value = 0
      }
    }
    catch {
      bufferedSec.value = 0
    }

    // dropped/total frames (best-effort across browsers)
    const q = (el as any).getVideoPlaybackQuality?.()
    if (q) {
      dropped.value = q.droppedVideoFrames ?? null
      total.value = q.totalVideoFrames ?? null
    }
    else {
      const wDropped = (el as any).webkitDroppedFrameCount
      const wTotal = (el as any).webkitDecodedFrameCount
      dropped.value = typeof wDropped === 'number' ? wDropped : null
      total.value = typeof wTotal === 'number' ? wTotal : null
    }
  }

  rafId = requestAnimationFrame(tick)
}

onMounted(() => {
  attach(props.videoEl)
  rafId = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  if (rafId)
    cancelAnimationFrame(rafId)
  detach(props.videoEl)
})
</script>

<template>
  <div class="perf-overlay" aria-hidden="true">
    <div>
      FPS: {{ fps }}
    </div>
    <div>
      Buffered: {{ bufferedSec.toFixed(1) }}s
    </div>
    <div>
      Stalls: {{ stalls }}
    </div>
    <div v-if="dropped != null && total != null">
      Dropped: {{ dropped }}/{{ total }}
    </div>
    <div v-if="readyState != null">
      RS: {{ readyState }}
    </div>
  </div>
</template>

<style scoped>
.perf-overlay {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 12px;
  line-height: 1.2;
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
    'Courier New', monospace;
  pointer-events: none;
  z-index: 5;
  min-width: 120px;
}
</style>
