let swRegistration: ServiceWorkerRegistration | null = null

navigator.serviceWorker?.addEventListener('message', (event) => {
  if (event.data.type === 'FETCH_REQUEST')
    window.parent.postMessage(event.data, '*')
})

window.addEventListener('message', (event) => {
  if (event.data.type === 'FETCH_RESPONSE')
    navigator.serviceWorker.controller?.postMessage(event.data)
})

export async function initServiceWorker() {
  if (swRegistration)
    return swRegistration

  try {
    swRegistration = await navigator.serviceWorker.register(
      '/miniapp-service-worker.js',
    )
    console.log('Service Worker registered')
    return swRegistration
  }
  catch (error) {
    console.error('SW registration failed:', error)
    return null
  }
}

export function isServiceWorkerActive(): boolean {
  return !!swRegistration?.active
}

export function useServiceWorker() {
  return {
    init: initServiceWorker,
    isActive: isServiceWorkerActive,
  }
}
