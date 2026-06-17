export type SwUpdateCallback = (version: string) => void

export function registerServiceWorker(onUpdate?: SwUpdateCallback) {
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // App still works without offline caching
    })

    // Listen for update messages from the new service worker
    navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
      if (event.data?.type === 'SW_UPDATED') {
        onUpdate?.(event.data.version as string)
      }
    })
  })
}
