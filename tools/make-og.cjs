// SNS で貼られたときの絵（og.png 1200×630）を作る。今日の問題（答え）は入れず、遊び方の例（禁止・注意・非常口＝？）だけ。
// 使い方: node tools/make-og.cjs（qa/ の playwright を使う）
const path = require("path");
const G = require(path.join(__dirname, "..", "gen.js"));
const { chromium } = require(path.join(__dirname, "..", "qa", "node_modules", "playwright"));
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  const sym = (id) => `<div style="width:190px;height:190px;background:#fff;border:5px solid #1f2a4433;border-radius:28px;padding:20px;box-sizing:border-box"><svg viewBox="0 0 40 40" width="140" height="140" style="fill:none;stroke:#1f2a44;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round"><style>.F{fill:#1f2a44;stroke:none}</style>${G.SYMS.find((x) => x.id === id).svg}</svg></div>`;
  await p.setContent(`<body style="margin:0;font-family:'Noto Sans CJK JP','IPAPGothic',sans-serif">
  <div style="width:1200px;height:630px;box-sizing:border-box;padding:56px 80px;background:#eef2e6;border-left:28px solid #b23c26;color:#1f2a44">
    <div style="font-size:34px;color:#86291a;letter-spacing:.08em">知らなくても遊べる・1日5問</div>
    <div style="font-size:100px;font-weight:900;margin-top:4px;letter-spacing:.04em;color:#142a52">ピクトグラム<span style="color:#b23c26">よみ</span></div>
    <div style="font-size:38px;margin-top:2px">駅や街の記号を見て、何を表すかを当てる</div>
    <div style="display:flex;gap:30px;align-items:center;margin-top:30px">${sym("kinen")}${sym("ippan")}${sym("hijoguchi")}<div style="font-size:64px;font-weight:900;color:#b23c26">何を表す？</div></div>
  </div></body>`);
  await p.screenshot({ path: path.join(__dirname, "..", "og.png") });
  await b.close();
})();
