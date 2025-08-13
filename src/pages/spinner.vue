<script setup lang="ts">
import LoadingSpinner from '~/components/LoadingSpinner.vue'

defineOptions({ name: 'SpinnerDemoPage' })
</script>

<template>
  <div class="page">
    <h1>Loading Spinner Demo</h1>

    <section>
      <h2>Default</h2>
      <LoadingSpinner />
    </section>

    <section>
      <h2>Custom size</h2>
      <div class="row">
        <LoadingSpinner :size="32" aria-label="Loading small" />
        <LoadingSpinner :size="48" aria-label="Loading medium" />
        <LoadingSpinner :size="96" aria-label="Loading large" />
        <LoadingSpinner size="6rem" aria-label="Loading x-large" />
      </div>
    </section>

    <section>
      <h2>Custom speed</h2>
      <div class="row">
        <div class="col">
          <p>Slow (2.5s)</p>
          <LoadingSpinner :speed="2.5" />
        </div>
        <div class="col">
          <p>Default (1.2s)</p>
          <LoadingSpinner />
        </div>
        <div class="col">
          <p>Fast (0.6s)</p>
          <LoadingSpinner :speed="0.6" />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page {
  padding: 24px;
  color: #fff;
  background: #111;
  min-height: 100vh;
}

h1,
h2,
p {
  margin: 0 0 12px;
}

section {
  margin-bottom: 24px;
}

.row {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
}

.col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
</style>
