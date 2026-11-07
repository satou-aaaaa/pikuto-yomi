// ピクトグラムよみを端末に保存して、電波が無くても遊べるようにする（PWA）。
// 画面は先にネットを見て、つながらないときだけ保存したものを使う（直した版がすぐ届く）。
// 記録（localStorage）には触らない。外へ何も送らない（よそのサイト＝文字の取り寄せは扱わない）。
const CACHE = "pikuto-v1";
const SHELL = ["./", "./index.html", "./data.js", "./gen.js", "./transfer.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("pikuto-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const fromCache = () => caches.match(req, { ignoreSearch: true })
    .then((hit) => hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined))
    .catch(() => undefined); // 保存したものを読めなくても、必ず返事を返す（ネットの返事か Response.error()）
  // ネットの返事と保存し直しは、イベントの中で waitUntil に預ける（4秒で保存したものを返したあとに届いても、新しい版を保存できる）
  const net = fetch(req);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  e.waitUntil(Promise.race([net.then((res) => { if (!res.ok) return; const copy = res.clone(); return Promise.race([caches.open(CACHE).then((c) => c.put(req, copy)), wait(15000)]); }, () => {}).catch(() => {}), wait(60000)])); // 保存の失敗は無視する。保存は始めてから15秒、全体は60秒で待つのをやめる（遅い通信でも保存でき、次の版の切り替えも止めない）
  // 4秒で保存したものに切り替える。本文を受け取り終えるまで切り替えを待ち（頭だけ届いて止まる通信でも開ける）、
  // 保存も無く通信も返らないときは20秒でエラーを返す（いつまでも待たせない）
  e.respondWith(new Promise((resolve) => {
    let sent = false; const send = (r) => { if (!sent) { sent = true; clearTimeout(slow); clearTimeout(give); resolve(r); } };
    const slow = setTimeout(() => fromCache().then((hit) => hit && send(hit)), 4000);
    const give = setTimeout(() => fromCache().then((hit) => send(hit || Response.error())), 20000);
    const fail = (res) => fromCache().then((hit) => send(hit || res || Response.error()));
    net.then((res) => {
      if (res.ok) return res.clone().arrayBuffer().then(() => send(res), () => fail());
      if (res.status >= 500) return fail(res);
      send(res);
    }, () => fail());
  }));
});
