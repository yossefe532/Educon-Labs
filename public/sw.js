self.addEventListener('push', function(event) {
  let data = { title: 'اشعار جديد', body: '', url: '/' }
  try {
    data = event.data.json()
  } catch (e) {}

  const options = {
    body: data.body,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    dir: 'rtl',
    lang: 'ar',
    data: { url: data.url || '/' },
    vibrate: [200, 100, 200],
    tag: 'educon-notification',
    renotify: true
  }

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  )
})

self.addEventListener('notificationclick', function(event) {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      return clients.openWindow(url)
    })
  )
})
