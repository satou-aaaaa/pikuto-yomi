// ひな形（shared-workflows template/qa/sw-check.mjs）。ゲームでは直さず写す。
// sw.js を Node の中で動かし、返事の仕方を確かめる（ブラウザ無し）。qa/run.mjs から checkSwStall(sw の中身) を呼ぶ。
// 本文の途中で通信が止まっても、保存したものへ切り替わるか（2026-11-07 CodeRabbit の指摘）。
import vm from "node:vm";

export async function checkSwStall(code) {
  const listeners = {};
  const cached = new Response("cached-page", { status: 200 });
  let mode = "stall";
  const ctx = {
    self: { addEventListener: (t, f) => (listeners[t] = f), location: { origin: "https://x.test" }, skipWaiting() {}, clients: { claim() {} } },
    caches: { match: async () => cached.clone(), open: async () => ({ put: async () => {} }), keys: async () => [] },
    fetch: async () => {
      if (mode === "ok") return new Response("net-page", { status: 200 });
      // 見出しは届くが本文が終わらない返事
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("half")); } }), { status: 200 });
    },
    setTimeout: (f, ms) => setTimeout(f, ms / 100), clearTimeout, URL, Request, Response, Promise, console,
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const ask = () => new Promise((resolve) => {
    listeners.fetch({ request: { method: "GET", url: "https://x.test/index.html", mode: "navigate" }, waitUntil() {}, respondWith: (p) => p.then(resolve) });
  });
  const stalled = await Promise.race([ask().then((r) => r.text()), new Promise((r) => setTimeout(() => r("timeout"), 300))]);
  mode = "ok";
  const normal = await Promise.race([ask().then((r) => r.text()), new Promise((r) => setTimeout(() => r("timeout"), 300))]);
  return { stalled, normal, ok: stalled === "cached-page" && normal === "net-page" };
}
