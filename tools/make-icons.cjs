// アプリのアイコン（icon-192.png・icon-512.png）を作る。生成りの紙に、朱の帯と、黄色い三角の注意の記号（このゲームの絵）。
// 使い方: node tools/make-icons.cjs（qa/ の playwright を使う）
const path = require("path");
const { chromium } = require(path.join(__dirname, "..", "qa", "node_modules", "playwright"));
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const s of [192, 512]) {
    const p = await b.newPage({ viewport: { width: s, height: s } });
    await p.setContent(`<body style="margin:0"><svg width="${s}" height="${s}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#eef2e6"/>
      <rect x="0" y="0" width="12" height="100" fill="#b23c26"/>
      <path d="M56 16L86 70H26z" fill="#f2c200" stroke="#111" stroke-width="4" stroke-linejoin="round"/>
      <path d="M52.5 32h7l-1.2 22h-4.6z" fill="#111"/><circle cx="56" cy="61.5" r="3.8" fill="#111"/></svg></body>`);
    await p.screenshot({ path: path.join(__dirname, "..", `icon-${s}.png`), clip: { x: 0, y: 0, width: s, height: s } });
  }
  await b.close();
})();
