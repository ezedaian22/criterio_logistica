/* Service worker de Criterio Logística.
 *
 * Objetivo: que la app abra aunque el chofer esté sin señal, sin que eso haga
 * que un deploy nuevo tarde en verse.
 *
 * Estrategia por tipo de pedido:
 *   - El HTML de la app  → primero la red, la caché solo si no hay conexión.
 *     (así un push a main se ve al toque, como hasta ahora)
 *   - Librerías de CDN   → primero la caché. Las URLs tienen la versión fijada,
 *     nunca cambian de contenido.
 *   - Tiles del mapa     → primero la caché, con tope de cantidad.
 *   - Supabase, Nominatim→ siempre a la red, nunca se cachean.
 *
 * Si alguna vez hay que desactivarlo: subir un sw.js con solo
 * self.addEventListener("install",()=>self.skipWaiting()) y un activate que
 * haga self.registration.unregister(). O en el celular: Ajustes del sitio →
 * Borrar datos.
 */

const VERSION = "criterio-v1";
const DOC_CACHE = VERSION + "-doc";
const LIB_CACHE = VERSION + "-lib";
const TILE_CACHE = VERSION + "-tiles";
const MAX_TILES = 400;

const LIB_HOSTS = [
  "unpkg.com",
  "cdn.jsdelivr.net",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.indexOf(VERSION) !== 0).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// Evita que la caché de tiles crezca sin límite.
async function podar(nombre, max) {
  try {
    const c = await caches.open(nombre);
    const ks = await c.keys();
    if (ks.length > max) {
      await Promise.all(ks.slice(0, ks.length - max).map((k) => c.delete(k)));
    }
  } catch (_) {}
}

function esLib(hostname) {
  return LIB_HOSTS.some((h) => hostname === h || hostname.endsWith("." + h));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch (_) {
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // Datos en vivo: nunca se cachean.
  if (url.hostname.endsWith("supabase.co")) return;
  if (url.hostname === "nominatim.openstreetmap.org") return;

  // El documento de la app: primero la red.
  if (req.mode === "navigate") {
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const c = await caches.open(DOC_CACHE);
          c.put("/", res.clone());
          return res;
        } catch (_) {
          const c = await caches.open(DOC_CACHE);
          const hit = await c.match("/");
          if (hit) return hit;
          return new Response(
            "<!doctype html><meta charset='utf-8'><title>Sin conexión</title>" +
              "<body style='background:#0f0f0f;color:#f0ece4;font-family:sans-serif;padding:40px;text-align:center'>" +
              "<h1 style='color:#c9a96e'>Sin conexión</h1>" +
              "<p>Abrí la app una vez con señal para que quede guardada en el teléfono.</p>",
            { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        }
      })()
    );
    return;
  }

  // Tiles del mapa.
  if (url.hostname.endsWith(".tile.openstreetmap.org")) {
    e.respondWith(
      (async () => {
        const c = await caches.open(TILE_CACHE);
        const hit = await c.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res && (res.ok || res.type === "opaque")) {
            c.put(req, res.clone());
            e.waitUntil(podar(TILE_CACHE, MAX_TILES));
          }
          return res;
        } catch (_) {
          return new Response("", { status: 504 });
        }
      })()
    );
    return;
  }

  // Librerías con versión fijada en la URL.
  if (esLib(url.hostname)) {
    e.respondWith(
      (async () => {
        const c = await caches.open(LIB_CACHE);
        const hit = await c.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res && (res.ok || res.type === "opaque")) c.put(req, res.clone());
          return res;
        } catch (err) {
          return Response.error();
        }
      })()
    );
    return;
  }

  // Resto del propio sitio (manifest, iconos): red con respaldo en caché.
  if (url.origin === self.location.origin) {
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res && res.ok) {
            const c = await caches.open(DOC_CACHE);
            c.put(req, res.clone());
          }
          return res;
        } catch (_) {
          const c = await caches.open(DOC_CACHE);
          const hit = await c.match(req);
          return hit || Response.error();
        }
      })()
    );
  }
});
