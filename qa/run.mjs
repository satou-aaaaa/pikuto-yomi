// ピクトグラムよみの検査。データ（記号の名前・なかま・出典・読み上げ用の説明）・問題の作り方（答えが1つ・似た組を並べない）・
// 今日の5問と上級の組み方（3年分・過去の日が変わらない）・とことんの並び（何百回）・通しで遊ぶ・まちがい・ヒント・続きから・
// 上級・練習・とことん・記号帳・実績・カレンダー・あとから・古いタブ・スマホ幅・PWA・引き継ぎコード・見やすさを確かめる。
// 使い方: node qa/run.mjs   失敗があれば終了コード 1。結果は qa-report/report.md。
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { checkTransfer } from "./transfer-check.mjs";
import { checkSwStall } from "./sw-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) });
const G = createRequire(import.meta.url)(path.join(root, "gen.js"));
const { SYMS, CATS } = G;
const optsKey = (P) => P.opts.join("/");

// ---- 1. データと問題の作り方（ブラウザを使わない）----
{
  const dupId = SYMS.map((x) => x.id).filter((v, i, a) => a.indexOf(v) !== i), dupN = SYMS.map((x) => x.n).filter((v, i, a) => a.indexOf(v) !== i);
  check("記号：id と名前が重ならない・番号が並びどおり", !dupId.length && !dupN.length && SYMS.every((x, i) => x.i === i), dupId.concat(dupN).join(","));
  check("記号：なかまは決めたものだけ・どのなかまにも4つ以上", SYMS.every((x) => CATS[x.c]) && Object.keys(CATS).every((c) => SYMS.filter((x) => x.c === c).length >= 4));
  check("記号：出典は国土交通省の案内用図記号（JIS Z 8210）の一覧", SYMS.every((x) => x.url === "https://www.mlit.go.jp/sogoseisaku/barrierfree/content/001727468.pdf"));
  check("記号：なかま（色と形の意味）は6つのどれかで、色と形の説明（kc）がある", SYMS.every((x) => Object.values(G.K).includes(x.k) && x.kc) && Object.keys(G.K).every((g) => SYMS.some((x) => x.g === g)));
  check("記号：色をじかに書いた塗りに class=\"F\" を付けない（CSS の色で上書きされる）", SYMS.every((x) => !/class="F"[^>]*fill="#/.test(x.svg)));
  const leak = SYMS.filter((x) => !x.alt || x.alt.includes(x.n)).map((x) => x.id);
  check("記号：読み上げ用の形の説明（alt）があり、名前そのものを言わない", leak.length === 0, leak.join(","));
  const long = SYMS.filter((x) => x.k.length > 26 || x.note.length > 60 || x.n.length > 16).map((x) => x.id);
  check("文は短く（なかま26字・ひとこと60字・名前16字まで）", long.length === 0, long.join(","));
  check("記号の絵は線と塗りだけ（script・外の画像を入れない）", SYMS.every((x) => x.svg.length > 20 && !/<script|href|url\(|on\w+=/i.test(x.svg)));
  check("記号は35以上・今日の5問に使う数（DAILY_N）は記号の数より多くない", SYMS.length >= 35 && G.DAILY_N <= SYMS.length, `${SYMS.length}`);
  check("なかまの色の問題にできる記号が25以上・案内でないなかまの記号が15以上", SYMS.filter(G.hasWhy).length >= 25 && SYMS.filter((x) => x.g !== "A").length >= 15, SYMS.filter(G.hasWhy).length);
  check("よく似た組（PAIRS）はどれも記号にある", G.PAIRS.every((pr) => pr.every((id) => SYMS.some((x) => x.id === id))));
}
{
  // 全部の記号×種類で、何通りもの種から作る：答えが1つ・選び肢4つがちがう・似た組を並べない・形のわけの文が重ならない
  const bad = [];
  let n = 0;
  for (const x of SYMS) for (const k of G.KINDS) {
    if (k.id === "g2" && !G.hasWhy(x)) continue;
    for (let s = 0; s < 8; s++) {
      const P = G.make(`${k.id}|${x.i}|s${s}`); n++;
      const os = P.opts.map((v) => SYMS[v]);
      if (P.opts.length !== 4 || new Set(P.opts).size !== 4 || P.opts.filter((v) => v === x.i).length !== 1) bad.push(`${x.id}/${k.id}`);
      if (os.some((a, i) => os.some((b, j) => i < j && G.paired(a, b)))) bad.push(`${x.id}/${k.id}/pair`);
      if (k.id === "g2" && (os.some((o) => !o.k) || new Set(os.map((o) => o.k)).size !== 4)) bad.push(`${x.id}/g2/why`);
    }
  }
  check(`問題：どの記号・種類でも、答えが1つ・選び肢4つがちがう・似た組を並べない（${n}問を作って確かめる）`, bad.length === 0, [...new Set(bad)].slice(0, 8).join(","));
  {
    // DAILY_N の後ろに記号を足しても、今日の5問・上級の問題は変わらない
    const req = createRequire(import.meta.url), dp = path.join(root, "data.js"), gp = path.join(root, "gen.js");
    const days = Array.from({ length: 120 }, (_, d) => new Date(Date.parse(G.EPOCH) + d * 864e5).toISOString().slice(0, 10));
    const shot = (g) => days.map((k) => [...g.dailyTags(k), ...g.hardTags(k)].map((t) => t + "=" + optsKey(g.make(t))).join(";")).join("\n");
    const before = shot(G), D = req(dp), n0 = D.SYMS.length;
    for (const x of D.SYMS.slice(0, 2)) D.SYMS.push({ ...x, i: D.SYMS.length, id: x.id + "x", n: x.n + "テスト", k: x.k ? x.k + "テスト" : "" });
    delete req.cache[gp]; const G2 = req(gp), after = shot(G2);
    D.SYMS.length = n0; delete req.cache[gp];
    check("DAILY_N の後ろに記号を足しても、今日の5問・上級の問題は変わらない（120日分）", before === after);
  }
  const same = ["otearai", "kinen", "hijoguchi"].every((id) => { const x = SYMS.find((y) => y.id === id); return JSON.stringify(G.make(`g0|${x.i}|z`)) === JSON.stringify(G.make(`g0|${x.i}|z`)); });
  check("同じ札なら同じ問題（種から作る）", same);
  const combos = G.KINDS.reduce((a, k) => a + G.combos(k.id).length, 0);
  check("練習・とことんで出る問題（種類×記号）が100種類以上", combos >= 100, combos);
}
{
  // 今日の5問・上級を3年分：今日の5つは重ならない・上級は今日と重ならない・1周するまで同じ記号は出ない
  const bad = [], seenCycle = new Map(); let noHard = 0, dup = 0;
  const start = Date.parse(G.EPOCH);
  for (let d = 0; d < 1100; d++) {
    const k = new Date(start + d * 864e5).toISOString().slice(0, 10);
    const t = G.dailyTags(k), h = G.hardTags(k), ws = t.map((x) => +x.split("|")[1]), hw = h.map((x) => +x.split("|")[1]);
    if (t.length !== 5 || new Set(ws).size !== 5 || h.length !== 3 || new Set(hw).size !== 3 || hw.some((w) => ws.includes(w))) bad.push(k);
    const kn = (p) => t.filter((x) => x.startsWith(p)).length, can = ws.some((w) => G.hasWhy(SYMS[w]));
    if (kn("b1") !== 2 || kn("g0") !== (can ? 2 : 3) || kn("g2") !== (can ? 1 : 0) || !h.every((x) => x.startsWith("g2|"))) bad.push(k + "/kinds");
    if (!t[4].startsWith("g2")) noHard++;
    if (![...t, ...h].every((x) => { try { G.make(x); return true; } catch { return false; } })) bad.push(k + "/make");
    if (ws.some((w) => w >= G.DAILY_N) || hw.some((w) => w >= G.DAILY_N)) bad.push(k + "/n");
    if (d < Math.floor(G.DAILY_N / 5)) for (const w of ws) { if (seenCycle.has(w)) dup++; seenCycle.set(w, k); }
  }
  check("今日の5問（記号よみ2・記号さがし2・形のわけ1。形のわけにできる記号が無い日だけ記号よみ3）と上級（形のわけ3・今日と重ならない）を3年分作れる", bad.length === 0, bad.slice(0, 5).join(","));
  check("今日の5問の5問目はほとんどの日で形のわけ（ない日は3年で5日まで）", noHard <= 5, `${noHard}日`);
  check(`今日の5問は、はじめの${Math.floor(G.DAILY_N / 5)}日で同じ記号を出さない（全部を一回りしてから次の周）`, dup === 0, dup);
  // 周のつなぎ目の日でも、どの周も全部の記号を1回ずつ出す（2026-11-07 CodeRabbit：借りた記号が周の中で2回出ていた）
  const seq = [];
  for (let d = 0; d < 1100; d++) seq.push(...G.dailySyms(new Date(start + d * 864e5).toISOString().slice(0, 10)));
  let badCycle = 0;
  for (let c = 0; (c + 1) * G.DAILY_N <= seq.length; c++) if (new Set(seq.slice(c * G.DAILY_N, (c + 1) * G.DAILY_N)).size !== G.DAILY_N) badCycle++;
  check("今日の5問の並びは、どの周（45問ずつ）も全部の記号を1回ずつ出す（3年分）", badCycle === 0, `${badCycle}周`);
  {
    // 上級は色のあるなかまだけ・今日のなかまの色も、5つに色のあるなかまがあればそれから（3年分）
    let badH = 0, badD = 0;
    for (let d = 0; d < 1100; d++) {
      const k = new Date(Date.parse(G.EPOCH) + d * 864e5).toISOString().slice(0, 10);
      if (!G.hardTags(k).every((t) => G.colored(G.SYMS[+t.split("|")[1]]))) badH++;
      const ws = G.dailySyms(k), g2 = G.dailyTags(k).find((t) => t.startsWith("g2|"));
      if (ws.some((w) => G.colored(G.SYMS[w])) && !G.colored(G.SYMS[+g2.split("|")[1]])) badD++;
    }
    check("上級は色のあるなかまの記号だけ・今日のなかまの色もなるべく色のある記号（3年分）", badH === 0 && badD === 0, `${badH}/${badD}`);
  }
  // 過去の日の問題が変わらない（data.js・gen.js を変えたら、ここの値が変わる。変えるなら PR に理由を書く）
  const snap = JSON.parse(readFileSync(path.join(root, "qa", "daily-snapshot.json"), "utf8"));
  const now = Object.fromEntries(Object.keys(snap).map((k) => [k, [...G.dailyTags(k), ...G.hardTags(k)].map((t) => `${t}=${optsKey(G.make(t))}`)]));
  const changed = Object.keys(snap).filter((k) => JSON.stringify(snap[k]) !== JSON.stringify(now[k]));
  check("過去と先の日の問題が、前に決めた問題と同じ（qa/daily-snapshot.json）", Object.keys(snap).length >= 20 && changed.length === 0, changed.slice(0, 5).join(","));
}

// ---- 2. ファイルの中身 ----
const html = readFileSync(path.join(root, "index.html"), "utf8"), gen = readFileSync(path.join(root, "gen.js"), "utf8"), data = readFileSync(path.join(root, "data.js"), "utf8");
const ext = [...html.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]).filter((u) => !/^https:\/\/fonts\.googleapis\.com(\/|$)|^https:\/\/ko-fi\.com\/satouaaaaa$|^https:\/\/(doi\.org|www\.mlit\.go\.jp)\//.test(u));
check("外から読むのは文字（Google Fonts）だけ。スクリプト・広告・解析を入れない（出典のリンクは押したときに開くだけ）", ext.length === 0 && ![...html.matchAll(/<script[^>]+src="([^"]+)"/g)].some((m) => /^https?:/.test(m[1])), ext.join(","));
check("CSP で通信先を自分だけにしている", /connect-src 'self'/.test(html) && !/connect-src[^;"]*https/.test(html));
check("Math.random は練習・とことんの種だけ（今日の5問・上級は日付の乱数。gen.js・data.js には無い）", (html.match(/Math\.random/g) || []).length === 2 && !/Math\.random/.test(gen + data));
check("乱数は sort の比較の中で引かない（ブラウザで引く回数が変わる）", !/\.sort\(\s*\([^)]*\)\s*=>[^\n;]*\b(R|rng|rand|Math\.random)\s*\(/.test(html + gen));
check("一行の式の途中にコメント // を足さない（行の残りが消える。rosen-hitofude 2026-11-04）", !/;\s*\/\/[^\n]*;\s*\w/.test((gen + data).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")));
check("画面にお笑いの言葉を入れない（本物っぽく）", !/お笑い|ギャグ|ツッコミ|なんでやねん|（うそ）/.test(html + data));
check("記号の出典（国土交通省の一覧・JIS Z 8210・JIS Z 9103）を「このゲームについて」と答えのあと・記号帳に出す", /mlit\.go\.jp/.test(html) && /出典：国土交通省/.test(html) && /JIS Z 9103/.test(html) && /このゲームのために描いた/.test(html));
check("好きなだけ遊べる：チケット・回数制限・🔒で開くモードを入れない", !/🎫|チケット|🔒|すると開く|のあとで開く/.test(html));
check("引き継ぎ：transfer.js をゲームの script より前に、このゲームの記録のキーだけで読む", /<script src="transfer\.js" data-game="pikuto-yomi" data-keys="pikuto-v1,pikuto-fs"><\/script>\s*<\/head>/.test(html) && html.indexOf('src="transfer.js"') < html.indexOf('src="data.js"') && /data-hk/.test(html) && existsSync(path.join(root, "transfer.js")));
{ const og = (k) => (html.match(new RegExp(`<meta (?:property|name)="${k}" content="([^"]+)"`)) || [])[1] || "";
  const png = readFileSync(path.join(root, "og.png"));
  check("SNS で貼ると絵と題が出る（OGP・1200×630・絶対URL）", og("og:title") && og("og:description") && og("og:image") === "https://satou-aaaaa.github.io/pikuto-yomi/og.png" && og("twitter:card") === "summary_large_image" && png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630); }
{ const fy = readFileSync(path.join(root, ".github/ISSUE_TEMPLATE/feedback.yml"), "utf8");
  check("感想フォームの name が3字以上（2字だとフォームが出ない。shared-workflows incidents/2026-11-05-feedback-form-not-shown.md）", [...((fy.match(/^name:\s*(.+)$/m) || [])[1] || "").trim()].length >= 3);
  check("感想フォームは名前・メールを聞かない", /id: fun/.test(fy) && !/id: (name|email|mail)/.test(fy) && /labels: \["感想"\]/.test(fy)); }
check("README の URL のすぐ後ろに全角の字を続けない（Link check が URL の一部と読む）", !/https?:\/\/[\x21-\x7e]*[^\x00-\x7f]/.test(readFileSync(path.join(root, "README.md"), "utf8").replace(/\]\(https?:\/\/[^)\s]+\)/g, "").replace(/<https?:\/\/[^>\s]+>/g, "")));
{ const sw = readFileSync(path.join(root, "sw.js"), "utf8"), mf = JSON.parse(readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
  const shell = JSON.parse(sw.match(/SHELL = (\[[^\]]+\])/)[1]);
  check("PWA：sw.js は画面のファイルを全部保存し（引き継ぎの transfer.js も）、外へ何も送らない", ["./index.html", "./data.js", "./gen.js", "./transfer.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"].every((f) => shell.includes(f)) && !/https?:\/\//.test(sw.replace(/^\/\/.*$/gm, "")));
  check("PWA：sw.js は install で取り直す（cache: reload）", /cache: "reload"/.test(sw));
  check("PWA：本文を受け取り終えるまで保存したものへの切り替えを待ち、保存も通信も無いときは20秒でエラーを返す", /arrayBuffer\(\)\.then\(\(\) => send\(res\)/.test(sw) && /setTimeout\([^;]*Response\.error\(\)[^;]*20000\)/.test(sw));
  const st = await checkSwStall(sw);
  check("PWA：本文の途中で通信が止まっても保存したものを返し、ふつうはネットの返事を返す（template/qa/sw-check.mjs）", st.ok, JSON.stringify(st));
  check("「動きを減らす」のときは、すべるスクロールにしない", !/behavior: "smooth"/.test(html) && /A11y\.on\("calm"\) \? "auto" : "smooth"/.test(html));
  check("PWA：manifest にアイコン2つと名前がある", mf.name === "ピクトグラムよみ" && mf.icons.length >= 2 && mf.start_url === "./"); }

// ---- 3. ブラウザで遊ぶ ----
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname), f = path.join(root, p === "/" ? "index.html" : p);
  if (!f.startsWith(root) || !existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); res.end(readFileSync(f));
}).listen(0);
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
// QA の間は、ブラウザの時計を始めた時刻に止める（日本時間の0時をまたいでも、TODAY とゲームの「今日」がずれない）
const START = Date.now();
const TODAY = new Date(START + 9 * 3600e3).toISOString().slice(0, 10);
const dayBefore = (n) => new Date(Date.parse(TODAY) - n * 864e5).toISOString().slice(0, 10);
async function newPage(w = 390, ctx) {
  const c = ctx || await browser.newContext({ viewport: { width: w, height: 800 } });
  if (!ctx) await c.clock.setFixedTime(START);
  await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/ERR_FAILED|net::/.test(m.text())) errors.push(m.text()); });
  await p.goto(url); await p.waitForTimeout(200);
  return p;
}
const closeHow = async (p) => { if (await p.locator("#howto[open]").count()) await p.click("#howto-ok"); };
const curOf = (p) => p.evaluate(() => { const c = __gg.cur(); return { kind: c.P.kind, ans: c.P.ans, opts: c.P.opts, wrong: c.wrong, i: c.i, tag: c.tag }; });
const mem = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("pikuto-v1") || "{}"));
// 1回まちがえる
async function miss(p) {
  const c = await curOf(p);
  await p.click(`.ch[data-j="${c.opts.findIndex((o) => o !== c.ans && !c.wrong.includes(o))}"]`);
}
async function solve(p, { wrong = 0 } = {}) {
  for (let i = 0; i < wrong; i++) await miss(p);
  const c = await curOf(p);
  await p.click(`.ch[data-j="${c.opts.indexOf(c.ans)}"]`);
  await p.waitForSelector(".verdict");
}

try {
  const p = await newPage();
  check("はじめて開くと遊び方が出る", await p.locator("#howto[open]").count() === 1);
  await p.click("#howto-ok");
  {
    // Esc で閉じても「見た」が残り、開き直しても遊び方が出ない（shared-workflows #186。ボタンでしか保存していなかった）
    const q = await newPage();
    await q.waitForSelector("#howto[open]");
    let bad = 0;
    for (let i = 0; i < 10; i++) {
      const r = i ? await newPage() : q;
      await r.waitForSelector("#howto[open]");
      await r.keyboard.press("Escape");
      if (!(await r.evaluate(() => __gg.load().tut))) bad++;   // 押したその場（すぐ読み直す）
      if (i) await r.context().close();
    }
    await q.reload(); await q.waitForSelector("#go-d");
    check("遊び方を Esc で閉じてすぐ読み直しても「見た」が残る（10回）・開き直しても出ない", bad === 0 && await q.locator("#howto[open]").count() === 0);
    await q.context().close();
    const o = await newPage();
    await o.waitForSelector("#howto[open]");
    await o.click("#howto-ok");
    check("「はじめる」を押したその場で「見た」が残る", await o.evaluate(() => __gg.load().tut) === true);
    await o.context().close();
  }
  check("ホームに今日のコツが出る", (await p.textContent("#tip")).includes("今日のコツ"));
  check("上級・とことん・練習は、はじめての日から押せる（鍵なし）", await p.locator("#go-h:not([disabled])").count() === 1 && await p.locator("#go-e:not([disabled])").count() === 1 && await p.locator("#go-p:not([disabled])").count() === 1);
  await p.click("#go-d");
  const tags = await p.evaluate(() => __gg.load().runs.d.list);
  check("今日の5問は日付から決まる（gen.js の dailyTags と同じ）", JSON.stringify(tags) === JSON.stringify(G.dailyTags(TODAY)));
  // 1問目（記号よみ）：記号の絵と、名前の選び肢4つ
  const q1 = await curOf(p), n1 = SYMS[q1.ans].n;
  check("記号よみ：記号の絵と名前の選び肢4つ・絵の読み上げは形の説明で、名前を言わない", q1.kind === "g0" && await p.locator(".pad .bigsym svg").count() === 1 && await p.locator(".ch").count() === 4 && !(await p.getAttribute(".pad .bigsym", "aria-label")).includes(n1) && !(await p.textContent(".pad")).includes(n1));
  await miss(p);
  check("まちがえると ✕ の印と「ちがう」の文字（色だけで分けない）・知らせは role=status", await p.locator(".ch.ng").count() === 1 && (await p.evaluate(() => getComputedStyle(document.querySelector(".ch.ng"), "::after").content)).includes("ちがう") && (await p.getAttribute("#msg", "role")) === "status");
  await p.reload(); await p.waitForTimeout(150); await p.click("#go-d");
  check("途中で閉じても続きから（同じ問題・まちがえた印のまま）", await p.locator(".ch.ng").count() === 1 && await p.evaluate(() => __gg.cur().i) === 0);
  await solve(p);
  check("正解すると ✓ の印・記号の説明と国土交通省の出典・★2（まちがい1回）", await p.locator(".ch.ok").count() === 1 && (await p.textContent(".verdict")).includes(n1) && await p.locator(".verdict .src a[href^='https://www.mlit.go.jp/']").count() === 1 && (await p.getAttribute(".verdict .stars", "aria-label")) === "星2つ");
  check("正解のあとの「🔊 読む」は答えと見かたを読む（問題文の読み上げ指定を外す）", await p.locator(".verdict[data-a11y-say]").count() === 1 && await p.locator(".q[data-a11y-say]").count() === 0);
  await p.click("#next");
  // 2問目：ヒント
  await p.click("#hint");
  check("ヒント1はなかまを言う（選び肢は消さない）", (await p.textContent("#hintbox")).includes("なかま") && await p.locator(".ch.ng").count() === 0);
  await p.click("#hint");
  check("ヒント2はまちがいの選び肢を消し、2つにしぼる・ヒントは2回まで", await p.locator(".ch.ng").count() === 2 && await p.locator("#hint:disabled").count() === 1);
  await solve(p);
  check("ヒント2回は★1", (await p.getAttribute(".verdict .stars", "aria-label")) === "星1つ");
  await p.click("#next");
  // 3問目：記号さがし
  { const c = await curOf(p), nm = SYMS[c.ans].n;
    const labels = await p.$$eval(".ch", (bs) => bs.map((b) => b.getAttribute("aria-label")));
    check("記号さがし：場所の名前と、記号の絵の選び肢4つ・選び肢の読み上げに名前を出さない", c.kind === "b1" && (await p.textContent(".pad .ja")) === nm && await p.locator(".choices.syms .ch svg").count() === 4 && labels.every((l) => l.startsWith("記号：") && !c.opts.some((v) => l.includes(SYMS[v].n)))); }
  await miss(p);
  check("記号さがし：まちがえると、押した記号の本当の名前を知らせる", /それは「.+」の記号です/.test(await p.textContent("#msg")));
  await solve(p);
  await p.click("#next");
  await solve(p); await p.click("#next");
  // 5問目：形のわけ（あれば）
  const last = await curOf(p);
  if (last.kind === "g2") {
    check("なかまの色：記号だけを出し（名前は出さない。答えが分かってしまう）・なかまの選び肢4つ", await p.locator(".pad .kk").count() === 0 && !(await p.textContent(".pad")).includes(SYMS[last.ans].n) && await p.locator(".choices.why .ch").count() === 4 && (await p.$$eval(".ch", (bs) => bs.map((b) => b.textContent))).includes(SYMS[last.ans].k));
  }
  await solve(p);
  await p.click("#next"); await p.waitForTimeout(150);
  const s1 = await mem(p);
  const expM = [1, 2, 1, 0, 0];
  check("5問で結果：今日の記録に1問ごとのまちがい＋ヒントの数", JSON.stringify(s1.days[TODAY]?.m) === JSON.stringify(expM), JSON.stringify(s1.days[TODAY]?.m));
  const share = await p.textContent(".share");
  const answers = tags.map((t) => SYMS[+t.split("|")[1]]);
  check("シェアの文に記号の名前（答え）を出さない（印だけ）", /第\d+回/.test(share) && /🔶/.test(share) && !answers.some((x) => share.includes(x.n)));
  check("まちがいのある日は Ko-fi の一言を出さない", await p.locator(".kofi").count() === 0);
  check("結果に今日の記号と形のわけ・あと少しの実績・続けて遊ぶ・上級のボタン", await p.locator("#rlist > div").count() === 5 && await p.locator("#achnext").count() === 1 && await p.locator("#go-e").count() === 1 && await p.locator("#go-h").count() === 1);
  check("記号帳に解いた記号が載る", Object.keys(s1.dex).length === 5);
  await p.click("#back");
  check("今日を終えたら、ホームは「今日の結果を見る」", (await p.textContent("#go-d")).includes("結果"));
  // 上級
  await p.click("#go-h");
  check("上級はヒントのボタンが無い・形のわけ3問", await p.locator("#hint").count() === 0 && JSON.stringify(await p.evaluate(() => __gg.load().runs.h.list)) === JSON.stringify(G.hardTags(TODAY)));
  for (let i = 0; i < 3; i++) { await solve(p); await p.click("#next"); }
  await p.waitForTimeout(100);
  check("上級の記録は hdays に入る", (await mem(p)).hdays[TODAY]?.m.length === 3);
  // 練習
  await p.click("#back");
  const before = await mem(p);
  await p.click("#go-p"); await p.click('.lv button[data-k="b1"]');
  const plist = await p.evaluate(() => __gg.load().runs.p.list);
  check("練習：選んだ種類で5問・まだ解いていない記号から", plist.length === 5 && plist.every((t) => t.startsWith("b1|")) && plist.every((t) => !before.dex[t.split("|")[1]]));
  for (let i = 0; i < 5; i++) { await solve(p); await p.click("#next"); }
  await p.waitForTimeout(100);
  const after = await mem(p);
  check("練習は今日の記録を増やさない（記号帳の数はふえる）", JSON.stringify(after.days) === JSON.stringify(before.days) && Object.keys(after.dex).length === Object.keys(before.dex).length + 5);
  await p.click("#go-dex");
  const nGot = await p.locator(".book button").count();
  check("記号帳：出会った記号が載り、まだのものは「？」", nGot >= 8 && await p.locator(".book .no").count() === SYMS.length - nGot);
  await p.click(".book button");
  check("記号帳の記号を押すと、なかまと国土交通省の出典が出る", await p.locator("#detail a[href^='https://www.mlit.go.jp/']").count() === 1);
  await p.click('button[data-c="s"]');
  check("記号帳の「なかまで練習」は、そのなかまの記号だけで5問", (await p.evaluate(() => __gg.load().runs.p.list)).every((t) => SYMS[+t.split("|")[1]].c === "s") && (await p.evaluate(() => __gg.load().runs.p.list)).length === 5);
  {
    // 記号が5つより少ないなかま（お店・観光は4つ）でも5問の練習になり、読み直しで消えない（2026-11-07 CodeRabbit）
    const small = Object.keys(G.CATS).filter((c) => SYMS.filter((x) => x.c === c).length < 5);
    const ok = await p.evaluate((cs) => cs.every((c) => { const list = __gg.catList(c); __gg.save((s) => { s.runs.p = { mode: "p", id: "cat" + c, date: __gg.todayKey(), list, res: [] }; }); const r = __gg.load().runs.p; return list.length === 5 && r && r.list.length === 5; }), small);
    check("記号が5つより少ないなかまでも、なかまで練習が5問で始まる", small.length > 0 && ok, small.join(","));
  }
  // とことん：まちがえても終わらない・降りるまで
  await p.click("#back"); await p.click("#go-e");
  const e0 = await p.evaluate(() => __gg.load().runs.e);
  check("とことんは記号よみ5 → 記号さがし10 から始まり、ライフ・チケットが無い", e0.list.slice(0, 5).every((t) => t.startsWith("g0|")) && e0.list.slice(5, 15).every((t) => t.startsWith("b1|")) && !("life" in e0) && await p.locator("#quit").count() === 1);
  await solve(p); await p.click("#next");
  await solve(p, { wrong: 3 }); await p.click("#next");
  await p.click("#hint"); await p.click("#hint"); await solve(p); await p.click("#next");
  check("とことん：まちがい・ヒントがいくつあっても続く", await p.evaluate(() => __gg.load().runs.e.res.length) === 3 && await p.locator(".ch").count() > 0);
  await p.reload(); await p.waitForTimeout(150);
  check("とことん：閉じても続きから", (await p.textContent("#go-e")).includes("続きから"));
  await p.click("#go-e"); await solve(p); await p.click("#next");
  await p.click("#quit"); await p.waitForTimeout(100);
  check("とことん：「ここで降りる」で終わり、一度で解いた数を自己ベストに（4問中2問）", (await mem(p)).ebest === 2 && (await p.textContent("#eres")).includes("4問") && (await p.textContent("#ebest")).includes("2問"));
  await p.click("#back");
  check("とことんの回を降りたら、ホームは新しく始めるボタン", !(await p.textContent("#go-e")).includes("続きから"));
  // 実績・このゲームについて
  await p.click("#go-ach");
  check("実績は14個で、腕前・集める・続けるの3つの組", await p.locator(".ach").count() === 14 && await p.locator(".agrp").count() === 3 && await p.locator(".ach.got").count() >= 2);
  check("達成した実績は ✓ の文字も付く（色だけで分けない）", (await p.textContent(".ach.got b")).startsWith("✓"));
  await p.click("#back"); await p.click("#f-about");
  check("このゲームについて：国土交通省の出典と研究の出典・絵は規格の図そのものではないこと", (await p.textContent("#about")).includes("国土交通省") && (await p.textContent("#about")).includes("規格の図そのものではありません") && await p.locator("#about a").count() >= 3);
  await p.context().close();

  // とことんの並びを何百回：1つの並びの中で同じ組が出ない・続けて同じ単語が出ない・全部の組が入る
  {
    const q = await newPage(); await closeHow(q);
    const r = await q.evaluate(() => { const bad = []; let len = 0; for (let n = 0; n < 300; n++) { const l = __gg.endlessList(n % 7); len = l.length; const ks = l.map((t) => t.split("|").slice(0, 2).join("|")); if (new Set(ks).size !== ks.length) bad.push("dup" + n); const w = l.map((t) => t.split("|")[1]); for (let i = 1; i < w.length; i++) if (w[i] === w[i - 1]) { bad.push("adj" + n); break; } if (w[0] === String(n % 7)) bad.push("join" + n); } return { bad, len }; });
    const total = G.KINDS.reduce((a, k) => a + G.combos(k.id).length, 0);
    check("とことんの並び（300回）：同じ組を出さない・同じ記号を続けない・前の並びの最後の記号から始めない・全部の組が入る", r.bad.length === 0 && r.len === total, `${r.bad.slice(0, 5).join(",")} 長さ${r.len}/${total}`);
    // 記録の形を直す：細工した値を画面に HTML として出さない
    await q.evaluate(() => { const s = JSON.parse(localStorage.getItem("pikuto-v1")) || { v: 1 }; s.ebest = '<img id="xss" src=x>'; s.dex = { 3: '"><b id="xss2">', constructor: 1, 99999: 1 }; s.runs = { h: { list: "bad", res: [] }, p: { mode: "p", id: "y", date: "2026-11-07", list: ["constructor|1|x"], res: [] }, d: { mode: "d", id: "z", date: "x", list: ["g0|1|x"], res: [] }, "a:2026-11-07": { mode: "a", id: "a1", date: "2026-11-07", list: ["g0|1|x", "g0|2|x", "g0|3|x", "g0|4|x", "g0|5|x"], res: [{ m: 0 }], cur: { i: 1, tag: "g0|2|x", wrong: "x", hints: 0 } }, e: { mode: "e", id: "e", date: "2026-11-07", list: ["b1|2|x", "g0|99999|x"], res: [] }, x: { id: "x", date: "2026-11-07", list: ["g0|1|x"], res: [{ m: 0 }] }, "a:2026-11-01": { mode: "d", id: "w", date: "2026-11-07", list: ["g0|1|x"], res: [] } }; s.days = { "2026-11-07": { m: "x" }, bad: { m: [0] }, "2026-02-30": { m: [0] } }; localStorage.setItem("pikuto-v1", JSON.stringify(s)); });
    await q.reload(); await q.waitForTimeout(250);
    const st = await q.evaluate(() => __gg.load());
    check("記録の形を直す：数の所の文字は0に・知らない記号・形のちがう途中経過（モードの無いもの・置き場所とモードが合わないものも）と日ごとの記録は捨てる", st.ebest === 0 && st.dex[3] === 0 && !Object.hasOwn(st.dex, "constructor") && !Object.hasOwn(st.dex, "99999") && !("h" in st.runs) && !("p" in st.runs) && !("d" in st.runs) && !("e" in st.runs) && !("x" in st.runs) && !("a:2026-11-01" in st.runs) && st.runs["a:2026-11-07"] && st.runs["a:2026-11-07"].cur === null && Object.keys(st.days).length === 0, JSON.stringify(st).slice(0, 380));
    await q.click("#go-dex").catch(() => {}); await q.waitForTimeout(150);
    check("記録の文字を HTML として出さない", await q.locator("#xss, #xss2").count() === 0);
    await q.context().close();
  }

  // 引き継ぎで入った記録の形を直す（2026-11-07 CodeRabbit の指摘）・前の日の終えた回を上書きする前に記録する
  {
    const q = await newPage(); await closeHow(q);
    const y = dayBefore(1), tags = G.dailyTags(y);
    await q.evaluate(([y, tags, today]) => { localStorage.setItem("pikuto-v1", JSON.stringify({ v: 1, tut: true, ebest: { toString: 0 }, dex: { "03": 1, 4: 1 }, days: { [today]: { m: [] } }, hdays: {}, adays: {}, kofi: {}, ach: {}, runs: { p: { mode: "p", id: "p1", date: today, list: [], res: [] }, e: { mode: "e", id: "e1", date: today, list: ["g2|999|x"], res: [] } } })); }, [y, tags, TODAY]);
    await q.reload(); await q.waitForTimeout(200);
    const st = await q.evaluate(() => __gg.load());
    check("記録の形を直す：数にできない値は0・記号の番号は 03 のような形を捨てる・無い記号の札・空の記録と空の途中経過を捨てる", st.ebest === 0 && !("03" in st.dex) && st.dex[4] === 1 && !st.days[TODAY] && !("p" in st.runs) && !("e" in st.runs) && await q.locator("#go-d").count() === 1, JSON.stringify(st).slice(0, 300));
    await q.evaluate(([y, tags]) => { const s = JSON.parse(localStorage.getItem("pikuto-v1")); s.days = {}; s.runs.d = { mode: "d", id: "y1", date: y, list: tags, res: tags.map(() => ({ m: 0 })), cur: null }; localStorage.setItem("pikuto-v1", JSON.stringify(s)); __gg.startRun("d"); }, [y, tags]);
    await q.waitForTimeout(100);
    const s2 = await q.evaluate(() => __gg.load());
    check("前の日の終えた回は、今日の回で上書きする前に記録に入る", !!s2.days[y] && s2.runs.d && s2.runs.d.date === TODAY);
    await q.context().close();
  }
  // 「🔊 読む」の文：記号の形と選び肢を読み、記号さがしではほかの選び肢の名前を言わない
  {
    const q = await newPage(); await closeHow(q);
    const bad = [];
    for (const k of ["g0", "b1", "g2"]) {
      const x = G.SYMS.find((s) => s.id === "kinen"), P = G.make(`${k}|${x.i}|say`);
      const say = await q.evaluate(([k, i]) => { __gg.save((s2) => { s2.runs.p = { mode: "p", id: "say" + k, date: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), list: Array(5).fill(`${k}|${i}|say`), res: [] }; }); __gg.play("p"); return document.querySelector("[data-a11y-say]").getAttribute("aria-label"); }, [k, x.i]);
      const names = P.opts.map((v) => G.SYMS[v].n);
      if (k === "b1") { if (!P.opts.every((v) => say.includes(G.SYMS[v].alt)) || names.some((n) => n !== x.n && say.includes(n))) bad.push(k); }
      else if (!say.includes(x.alt) || !P.opts.every((v) => say.includes(k === "g2" ? G.SYMS[v].k : G.SYMS[v].n))) bad.push(k);
    }
    check("「🔊 読む」は記号の形と選び肢も読む（記号さがしではほかの選び肢の名前を言わない）", bad.length === 0, bad.join(","));
    await q.context().close();
  }

  // まちがいなしの日は Ko-fi を1回だけ
  {
    const q = await newPage(); await closeHow(q); await q.click("#go-d");
    for (let i = 0; i < 5; i++) { await solve(q); await q.click("#next"); }
    await q.waitForTimeout(150);
    check("全部まちがいなしで初めて終えたときだけ Ko-fi の一言", await q.locator(".kofi").count() === 1 && (await q.textContent(".big")).includes("まちがいなし"));
    await q.click("#back"); await q.click("#go-d");
    check("結果をもう一度見ても Ko-fi は出さない", await q.locator(".kofi").count() === 0);
    await q.context().close();
  }

  // カレンダー・あとから：過去の日の記録を置いて見る
  {
    const q = await newPage();
    await q.evaluate(([d2, d3]) => { localStorage.setItem("pikuto-v1", JSON.stringify({ v: 1, tut: true, days: { [d2]: { m: [0, 0, 0, 0, 0], k: [] }, [d3]: { m: [1, 0, 0, 2, 0], k: [] } }, hdays: {}, adays: {}, dex: {}, runs: {}, kofi: {}, ach: {}, ebest: 0 })); }, [dayBefore(2), dayBefore(3)]);
    await q.reload(); await q.waitForTimeout(150);
    check("ホームの「続けて」は、きのうを休んだら — （休んだ日を責めない）", (await q.textContent(".stats")).includes("—"));
    await q.click("#go-cal");
    const lateList = await q.evaluate(() => __gg.lateDays(__gg.load()));
    const exp = [1, 4, 5, 6, 7].map(dayBefore).filter((d) => d >= G.EPOCH);
    check("カレンダー：取りこぼした過去7日（第1回より後）を押せる", JSON.stringify(lateList) === JSON.stringify(exp), lateList.join(","));
    if (lateList.length) {
      const d = lateList[0];
      if (d.slice(0, 7) !== TODAY.slice(0, 7)) await q.click("#prev");
      await q.click(`.cal .miss[data-k="${d}"]`);
      check("あとから：その日の今日の5問と同じ問題", JSON.stringify(await q.evaluate((d) => __gg.load().runs["a:" + d].list, d)) === JSON.stringify(G.dailyTags(d)));
      for (let i = 0; i < 5; i++) { await solve(q); await q.click("#next"); }
      await q.waitForTimeout(150);
      const s = await mem(q);
      check("あとからは adays に入り、今日の記録・続けた日・シェア・Ko-fi には数えない", s.adays[d] && !s.days[d] && (await q.locator(".share").count()) === 0 && (await q.locator(".kofi").count()) === 0);
    } else check("カレンダー：第1回の日はあとから遊べる日が無い", lateList.length === 0);
    await q.context().close();
  }

  // 別のタブでヒントを使ったあと、この画面で正解しても、そのヒントを★に入れる
  {
    const q = await newPage(); await closeHow(q); await q.click("#go-h");
    await q.evaluate(() => { const s = JSON.parse(localStorage.getItem("pikuto-v1")); const r = s.runs.h; r.cur = { i: 0, tag: r.list[0], wrong: [], hints: 2 }; localStorage.setItem("pikuto-v1", JSON.stringify(s)); });
    await solve(q);
    check("別のタブで使ったヒントも、正解したときの★に入れる（★3にしない）", (await q.evaluate(() => __gg.load().runs.h.res[0].m)) >= 2 && !(await q.textContent(".verdict .hd")).includes("★★★"));
    await q.context().close();
  }
  // あとから：開いたまま期限（過去7日）を過ぎたら、答えを受け付けずホームへ
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const later = START + 3 * 864e5; await ctx.clock.setFixedTime(later);
    const q = await newPage(390, ctx); await closeHow(q);
    const d = await q.evaluate(() => __gg.lateDays(__gg.load())[0]);
    if (d) {
      await q.click("#go-cal"); await q.click(`.cal .miss[data-k="${d}"]`);
      await ctx.clock.setFixedTime(later + 9 * 864e5);
      const c = await curOf(q);
      await q.click(`.ch[data-j="${c.opts.indexOf(c.ans)}"]`);
      await q.waitForTimeout(150);
      check("あとから：開いたまま期限を過ぎたら答えを受け付けない（記録に入れず、途中経過も消す）", !(await q.evaluate((d) => __gg.load().adays[d], d)) && !(await q.evaluate((d) => __gg.load().runs["a:" + d], d)) && await q.locator("#go-d").count() === 1);
    } else check("あとから：期限の検査に使う日がある", false);
    await ctx.close();
  }

  // 古いタブ：同じ問題を2つのタブで開き、片方で答えたら、もう片方は二重に入れない
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    await ctx.clock.setFixedTime(START);
    const a = await newPage(390, ctx); await closeHow(a); await a.click("#go-d");
    const b = await ctx.newPage(); b.on("pageerror", (e) => errors.push(e.message)); await b.goto(url); await b.waitForTimeout(150); await b.click("#go-d");
    await solve(a);
    { const c = await curOf(b); await b.click(`.ch[data-j="${c.opts.indexOf(c.ans)}"]`); }
    await b.waitForTimeout(200);
    const s = await mem(a);
    check("古いタブで同じ問題に答えても二重に数えない", s.runs.d.res.length === 1 && Object.values(s.dex).reduce((x, y) => x + y) === 1);
    await a.click("#next"); await b.goto(url); await b.waitForTimeout(150); await b.click("#go-d");
    await a.click("#hint"); await a.click("#hint");
    await b.click("#hint");
    check("別のタブで使ったヒントの数を減らさない", (await mem(a)).runs.d.cur.hints === 2);
    await ctx.close();
  }

  // スマホ幅・大きい文字でもはみ出さない・押す所は44px以上
  {
    const bad = [], small = [];
    for (const [w, fs] of [[320, 3], [390, 2], [320, 1]]) {
      const q = await newPage(w); await closeHow(q);
      await q.evaluate((fs) => localStorage.setItem("pikuto-fs", String(fs)), fs); await q.reload(); await q.waitForTimeout(150);
      for (const go of [null, "#go-d", "solve", "solve2", "solve3", "#go-cal", "#go-dex", "#go-ach", "#go-e"]) {
        if (go && go.startsWith("solve")) { if (go !== "solve") await q.click("#next"); await solve(q); }
        else if (go) { await q.goto(url); await q.waitForTimeout(100); await q.click(go); }
        await q.waitForTimeout(100);
        const ov = await q.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (ov > 0) bad.push(`${w}px 文字${fs} ${go || "ホーム"} ${ov}px`);
        small.push(...(await q.$$eval("button:not([disabled]), a[href]", (bs) => bs.filter((b) => b.checkVisibility() && !b.closest(".cal")).filter((b) => b.getBoundingClientRect().height < 44).map((b) => (b.id || b.className || b.textContent).slice(0, 20)))).map((x) => `${w}/${fs}/${go}:${x}`));
      }
      await q.context().close();
    }
    check("幅320px・とても大きい文字でも横にはみ出さない", bad.length === 0, bad.join(" / "));
    check("押せる所は高さ44px以上", small.length === 0, [...new Set(small)].slice(0, 8).join(","));
  }

  // 見やすさの設定を全部入れても、ページの一番下まで動ける
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 700 } });
    await ctx.clock.setFixedTime(START);
    await ctx.addInitScript(() => localStorage.setItem("a11y-v1", JSON.stringify({ read: true, cvd: true, calm: true, say: true, ruby: true })));
    const q = await newPage(390, ctx); await closeHow(q);
    const r = await q.evaluate(() => { window.scrollTo(0, 1e5); const f = document.querySelector("footer").getBoundingClientRect(); return [scrollY, Math.round(f.bottom), innerHeight, getComputedStyle(document.documentElement).position]; });
    check("見やすさの設定を全部入れても、いちばん下まで動ける（html が固定されない）", r[0] > 0 && r[1] <= r[2] && r[3] === "static", r.join(","));
    await ctx.close();
  }
  // キーボードだけで遊べる（Tab と Enter）
  {
    const q = await newPage(); await closeHow(q);
    await q.focus("#go-d"); await q.keyboard.press("Enter"); await q.waitForTimeout(100);
    const c = await curOf(q);
    await q.focus(`.ch[data-j="${c.opts.indexOf(c.ans)}"]`); await q.keyboard.press("Enter"); await q.waitForTimeout(100);
    check("キーボードだけで選んで答えられる", await q.locator(".verdict").count() === 1);
    await q.context().close();
  }
} catch (e) { check("ブラウザでの検査が最後まで動く", false, e.stack.split("\n").slice(0, 3).join(" ")); }

// 引き継ぎコード（shared-workflows template/qa/transfer-check.mjs）
try {
  const sample = { "pikuto-v1": JSON.stringify({ v: 1, tut: true, days: { "2026-11-07": { m: [0, 1, 0, 0, 2], k: ["g0|1", "g0|2", "b1|3", "b1|4", "g2|5"] } }, hdays: {}, adays: {}, dex: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 }, runs: {}, kofi: {}, ach: {}, ebest: 7, t: 1 }), "pikuto-fs": "2" };
  await checkTransfer({ browser, url, game: "pikuto-yomi", sample, check, open: async (pg) => { if (await pg.locator("#howto[open]").count()) await pg.click("#howto-ok"); } });
} catch (e) { check("引き継ぎの検査が最後まで動く", false, e.message.split("\n")[0]); }
await browser.close();
server.close();
check("画面のエラーが無い", errors.length === 0, errors.slice(0, 3).join(" | "));

{ // 見やすさ・読みやすさ・偏り（shared-workflows template/qa/a11y.mjs の写し）
  const { spawnSync } = await import("node:child_process");
  const a = spawnSync(process.execPath, [path.join(root, "qa", "a11y.mjs")], { encoding: "utf8", env: process.env });
  check("見やすさ・読みやすさの検査（qa/a11y.mjs。中身は qa-report/a11y.md）", a.status === 0, (a.stdout.match(/^- ❌.*$/gm) || []).join(" / ") || (a.status ? a.stderr.slice(-300) : ""));
}

const ng = results.filter((r) => !r.ok);
const md = `# ピクトグラムよみ QA\n\n${results.map((r) => `- ${r.ok ? "✅" : "❌"} ${r.name}${r.detail ? `（${r.detail}）` : ""}`).join("\n")}\n\n${ng.length ? `❌ ${ng.length}件` : `✅ ${results.length}項目すべて通過`}\n`;
mkdirSync(path.join(root, "qa-report"), { recursive: true });
writeFileSync(path.join(root, "qa-report/report.md"), md);
console.log(md);
process.exit(ng.length ? 1 : 0);
