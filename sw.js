"use strict";

const CACHE_NAME = "ngon-so-v2";
const ASSET_CACHE_NAME = "ngon-so-assets-v1";
const ACTIVE_CACHES = [CACHE_NAME, ASSET_CACHE_NAME];
const MEDIAPIPE_PACKAGE_PATH = "/npm/@mediapipe/tasks-vision@0.10.14/";
const HAND_MODEL_PATH =
  "/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const APP_BASE = new URL("./", self.registration.scope);
const APP_SHELL = [
  "",
  "styles.css",
  "web.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png"
].map((path) => new URL(path, APP_BASE).toString());

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith("ngon-so-") && !ACTIVE_CACHES.includes(key))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET") {
    return;
  }

  const isMediaPipePackage = url.hostname === "cdn.jsdelivr.net" &&
    url.pathname.startsWith(MEDIAPIPE_PACKAGE_PATH);
  const isHandModel = url.hostname === "storage.googleapis.com" &&
    url.pathname === HAND_MODEL_PATH;
  if (isMediaPipePackage || isHandModel) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE_NAME);
      const cachedResponse = await cache.match(request);
      if (cachedResponse) return cachedResponse;
      const response = await fetch(request);
      if (response.ok && response.type !== "opaque") {
        await cache.put(request, response.clone()).catch((error) => {
          console.warn("Could not cache a MediaPipe asset:", error);
        });
      }
      return response;
    })());
    return;
  }

  if (url.origin !== self.location.origin || !url.pathname.startsWith(APP_BASE.pathname)) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cachedPage = await caches.match(APP_BASE.toString());
        if (cachedPage) return cachedPage;
        throw new Error("The app shell is not available offline.");
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => cachedResponse || fetch(request))
  );
});
