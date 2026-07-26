/* =========================================================
   MindSwitch - service-worker.js
   オフライン起動用のキャッシュと、アップデート通知の仕組み。

   ★ バージョンを上げる際の注意 ★
   このアプリを更新してGitHubへ再アップロードするときは、
   下の CACHE_VERSION の数字を必ず1つ増やしてください。
   （例："mindswitch-cache-v1" → "mindswitch-cache-v2"）
   これを忘れると、利用者の端末に古いキャッシュが残ったままになり、
   更新内容が反映されません。
========================================================= */
const CACHE_VERSION = "mindswitch-cache-v1";

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./storage.js",
  "./app.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-192.png",
  "./icon-maskable-512.png"
];

self.addEventListener("install", (event)=>{
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache)=> cache.addAll(CORE_ASSETS)).catch(()=>{})
  );
});

self.addEventListener("activate", (event)=>{
  event.waitUntil(
    caches.keys().then((keys)=>
      Promise.all(
        keys.filter((k)=> k !== CACHE_VERSION).map((k)=> caches.delete(k))
      )
    ).then(()=> self.clients.claim())
  );
});

// ホーム画面から起動した直後にすぐ新しい内容を反映できるよう、
// index.htmlとJS/CSSはネットワーク優先（取得できなければキャッシュへ）、
// それ以外（アイコン等）はキャッシュ優先で返す。
self.addEventListener("fetch", (event)=>{
  const req = event.request;
  if(req.method !== "GET") return;

  const isCoreFile = /\.(html|js|css|webmanifest)$/.test(new URL(req.url).pathname) ||
    new URL(req.url).pathname.endsWith("/");

  if(isCoreFile){
    event.respondWith(
      fetch(req).then((res)=>{
        const resClone = res.clone();
        caches.open(CACHE_VERSION).then((cache)=> cache.put(req, resClone));
        return res;
      }).catch(()=> caches.match(req).then((cached)=> cached || caches.match("./index.html")))
    );
  }else{
    event.respondWith(
      caches.match(req).then((cached)=> cached || fetch(req))
    );
  }
});

// app.js側から「更新する」がタップされた際に送られてくるメッセージ。
// 待機中のService Workerへ即座に制御を引き継がせる。
self.addEventListener("message", (event)=>{
  if(event.data && event.data.type === "SKIP_WAITING"){
    self.skipWaiting();
  }
});
