/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-afac4cd2'], (function (workbox) { 'use strict';

  self.skipWaiting();
  workbox.clientsClaim();
  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "pwa-maskable-512x512.png",
    "revision": "cc493bdfd161c0cc0c2d20dc9dc9953a"
  }, {
    "url": "pwa-512x512.png",
    "revision": "0bccb57bf98cf849725a121a1e470047"
  }, {
    "url": "pwa-192x192.png",
    "revision": "b5a8b20a6be1b1b1bd542df2c6c39fb9"
  }, {
    "url": "index.html",
    "revision": "b20a5fc263f129373ef93f7219fa6f40"
  }, {
    "url": "icon.svg",
    "revision": "cbdcee82eb2797f2f96e757de87ddf5e"
  }, {
    "url": "icon-maskable.svg",
    "revision": "f646997471797e35a64f30688759cfa9"
  }, {
    "url": "apple-touch-icon.png",
    "revision": "ccee16e5e5a01027115ecf0db8d5246b"
  }, {
    "url": "icons/pwa-maskable-512x512.png",
    "revision": "cc493bdfd161c0cc0c2d20dc9dc9953a"
  }, {
    "url": "icons/pwa-512x512.png",
    "revision": "0bccb57bf98cf849725a121a1e470047"
  }, {
    "url": "icons/pwa-192x192.png",
    "revision": "b5a8b20a6be1b1b1bd542df2c6c39fb9"
  }, {
    "url": "icons/icon.svg",
    "revision": "cbdcee82eb2797f2f96e757de87ddf5e"
  }, {
    "url": "icons/apple-touch-icon.png",
    "revision": "ccee16e5e5a01027115ecf0db8d5246b"
  }, {
    "url": "assets/workbox-window.prod.es5-Bd17z0YL.js",
    "revision": null
  }, {
    "url": "assets/index-HKePgK_b.css",
    "revision": null
  }, {
    "url": "assets/index-B9ctC5b8.js",
    "revision": null
  }, {
    "url": "apple-touch-icon.png",
    "revision": "ccee16e5e5a01027115ecf0db8d5246b"
  }, {
    "url": "icon.svg",
    "revision": "cbdcee82eb2797f2f96e757de87ddf5e"
  }, {
    "url": "pwa-192x192.png",
    "revision": "b5a8b20a6be1b1b1bd542df2c6c39fb9"
  }, {
    "url": "pwa-512x512.png",
    "revision": "0bccb57bf98cf849725a121a1e470047"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "cc493bdfd161c0cc0c2d20dc9dc9953a"
  }, {
    "url": "manifest.webmanifest",
    "revision": "480a2a2ac13a51b54f569c3bb6354439"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("index.html"), {
    denylist: [/^\/api\//]
  }));
  workbox.registerRoute(/^https:\/\/fonts\.googleapis\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "google-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');
  workbox.registerRoute(/^https:\/\/fonts\.gstatic\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "gstatic-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');

}));
