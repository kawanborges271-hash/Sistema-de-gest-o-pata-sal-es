// Service worker mínimo: deixa o Salon OS instalável como app.
// Não guarda nada em cache, então cada deploy novo aparece na hora.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
