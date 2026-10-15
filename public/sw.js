/*
 * Service worker — caches the app shell and public assets ONLY.
 * Never caches API / Firestore / Functions responses, payment proofs or member files.
 * Sensitive changes always require a live connection.
 */
// Bump when cached files change in a way old phones must not keep (v2: icons/brand/media no longer cache-first).
const VERSION = 'shell-v2';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
  // Do not skipWaiting automatically: the app shows "update available" and lets the user choose,
  // so an open form is never lost by a surprise reload.
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Built files have a content hash in their name (assets/), so a cached copy is always the right one.
const HASHED_ASSET = /\/assets\//;
// Icons, logos and pictures keep the same name when a gym changes them (gym-icon.png → icons/…),
// so they are fetched fresh when online and the cached copy is used only offline.
const PUBLIC_FILE = /\/(icons|brand|media)\/|manifest\.webmanifest$/;

const keep = (req, res) => {
  if (res.ok) {
    const copy = res.clone();
    caches.open(VERSION).then((c) => c.put(req, copy));
  }
  return res;
};

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fonts and Firebase go straight to the network

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }
  if (HASHED_ASSET.test(url.pathname)) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => keep(req, res))));
    return;
  }
  if (PUBLIC_FILE.test(url.pathname)) {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => keep(req, res))
        .catch(() => caches.match(req).then((hit) => hit || Response.error())),
    );
  }
});
