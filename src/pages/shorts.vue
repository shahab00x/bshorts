<script setup lang="ts">
import ShortsFeed from '~/components/ShortsFeed.vue'

defineOptions({ name: 'ShortsPage' })
</script>

<template>
  <ShortsFeed />
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
</style>
