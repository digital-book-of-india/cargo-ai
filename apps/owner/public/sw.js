/* Minimal push handler for DBI Intelligence. It shows a generic notice and opens the app.
   It never shows camera pictures or any detail from the message body. */
self.addEventListener("push", (event) => {
  event.waitUntil(
    self.registration.showNotification("DBI Intelligence", {
      body: "You have a new alert. Open the app to review it.",
      tag: "dbi-alert",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/notifications"));
});
