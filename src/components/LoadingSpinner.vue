<script setup lang="ts">
const props = withDefaults(defineProps<{
  size?: number | string
  speed?: number
  ariaLabel?: string
}>(), {
  size: '64px',
  speed: 1.2,
  ariaLabel: 'Loading',
})

const sizeCss = computed(() =>
  typeof props.size === 'number' ? `${props.size}px` : props.size,
)
const speedCss = computed(() => `${props.speed}s`)
</script>

<template>
  <div
    class="loading-spinner"
    role="status"
    :aria-label="ariaLabel"
    aria-live="polite"
    :style="{ '--size': sizeCss, '--speed': speedCss } as any"
  >
    <!-- Static inner logo -->
    <img
      class="inner"
      src="/inner_logo.svg"
      alt=""
      aria-hidden="true"
      decoding="async"
      fetchpriority="low"
    >

    <!-- Rotating outer logo -->
    <div class="outer-wrap" aria-hidden="true">
      <img
        class="outer"
        src="/outer_logo.svg"
        alt=""
        decoding="async"
        fetchpriority="low"
      >
    </div>

    <span class="sr-only">{{ ariaLabel }}</span>
  </div>
</template>

<style scoped>
.loading-spinner {
  position: relative;
  display: inline-block;
  width: var(--size);
  height: var(--size);
  /* helps with animation smoothness */
  contain: layout paint;
}

.inner,
.outer {
  width: 100%;
  height: 100%;
  display: block;
}

/* Center the inner (static) */
.inner {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  will-change: transform;
}

/* Center and rotate the outer */
.outer-wrap {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 100%;
  height: 100%;
  transform: translate(-50%, -50%);
  animation: spinner-rotate var(--speed) linear infinite;
  will-change: transform;
}

@keyframes spinner-rotate {
  0% {
    transform: translate(-50%, -50%) rotate(0deg);
  }
  100% {
    transform: translate(-50%, -50%) rotate(360deg);
  }
}

/* Accessibility: screen-reader only text */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Respect reduced motion */
@media (prefers-reduced-motion: reduce) {
  .outer-wrap {
    animation-duration: calc(var(--speed) * 3);
  }
}
</style>
