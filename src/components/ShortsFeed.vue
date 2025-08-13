<script setup lang="ts">
import HlsVideo from '~/components/HlsVideo.vue'

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

function setCardRef(el: HTMLElement | null, idx: number) {
  cardRefs.value[idx] = el
}

function getHls(item: VideoItem): string | null {
  return item.videoInfo?.peertube?.hlsUrl || item.rawPost?.peertube?.hlsUrl || null
}

function inWindow(idx: number) {
  // Only render current and next 3 items to limit downloads
  return idx >= currentIndex.value && idx <= currentIndex.value + 3
}

function shouldLoad(idx: number) {
  // Load current and next 3
  return idx >= currentIndex.value && idx <= currentIndex.value + 3
}

function shouldPlay(idx: number) {
  return idx === currentIndex.value
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

    if (bestIdx >= 0)
      currentIndex.value = bestIdx
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
      >
        <HlsVideo
          v-if="inWindow(idx)"
          :src="getHls(it)!"
          :muted="true"
          :loop="true"
          :should-load="shouldLoad(idx)"
          :should-play="shouldPlay(idx)"
        />
        <div v-else class="video-placeholder" />

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
