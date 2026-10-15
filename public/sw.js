// Service worker do CRM (PWA instalável). Não guarda nada em cache: o CRM depende de dados ao vivo e sempre
// carrega a versão nova. O app do técnico (/tecnico) tem o próprio, com escopo mais específico (sw-tecnico.js).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
