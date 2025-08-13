<script setup lang="ts">
const route = useRoute()
const isShorts = computed(() => route.path === '/' || route.path.startsWith('/shorts'))
</script>

<template>
  <main font-sans text="gray-700 dark:gray-200" :class="isShorts ? 'app-shorts' : 'app-default'">
    <RouterView />
    <TheFooter v-if="!isShorts" />
  </main>
</template>

<style scoped>
.app-default {
  padding: 2.5rem 1rem; /* y-10 x-4 */
  text-align: center;
}
.app-shorts {
  padding: 0;
  margin: 0;
  height: 100vh;
}
</style>
