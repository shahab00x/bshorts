import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router/auto'
import App from './App.vue'

import '@unocss/reset/tailwind.css'
import './styles/main.css'
import 'uno.css'
import { SdkService } from './composables/sdkService'

// Ensure the Bastyon SDK is fully initialized before mounting the app
;

(async () => {
  try {
    await SdkService.init()
  }
  catch (e) {
    // Initialization failing should not block UI, but log it
    console.error('SdkService.init() failed:', e)
  }

  const app = createApp(App)
  const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
  })

  app.use(router)
  app.mount('#app')
})()
