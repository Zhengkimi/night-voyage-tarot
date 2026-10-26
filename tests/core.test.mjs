// 核心層單元測試：node --test tests/
// 從 index.html 抽出 <script id="tarot-core">，在隔離的 vm 環境執行，不需要瀏覽器或任何套件。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const m = html.match(/<script id="tarot-core">([\s\S]*?)<\/script>/);
assert.ok(m, "index.html 中找不到 <script id=\"tarot-core\">");

function loadCore(extra = {}) {
  const ctx = vm.createContext({ crypto: globalThis.crypto, ...extra });
  vm.runInContext(m[1], ctx);
  return ctx.Tarot;
}
const T = loadCore();
const { CARDS, MAJORS, SUITS, SPREADS } = T;

// 可重現的亂數：給定序列，用於驗證 shuffle 的演算法本身
function seeded(seed = 1) {
  let s = seed >>> 0;
  return n => { s = (s * 1664525 + 1013904223) >>> 0; return s % n; };
}
const pick = (i, rev = false) => ({ i, rev });
const idxOf = zh => CARDS.findIndex(c => c.zh === zh);

describe("資料層：牌組", () => {
  test("共 78 張：22 張大阿爾克那 + 4 花色 × 14 張", () => {
    assert.equal(MAJORS.length, 22);
    assert.equal(SUITS.length, 4);
    SUITS.forEach(s => assert.equal(s.m.length, 14, `${s.zh} 應有 14 張`));
    assert.equal(CARDS.length, 78);
    assert.equal(CARDS.filter(c => c.major).length, 22);
  });

  test("大阿爾克那編號 0–21 依序排列", () => {
    CARDS.slice(0, 22).forEach((c, i) => assert.equal(c.n, i));
    assert.equal(CARDS[0].zh, "愚者");
    assert.equal(CARDS[21].zh, "世界");
  });

  test("小阿爾克那順序：權杖 → 聖杯 → 寶劍 → 錢幣，各王牌～國王", () => {
    assert.equal(CARDS[22].zh, "權杖王牌");
    assert.equal(CARDS[35].zh, "權杖國王");
    assert.equal(CARDS[36].zh, "聖杯王牌");
    assert.equal(CARDS[50].zh, "寶劍王牌");
    assert.equal(CARDS[64].zh, "錢幣王牌");
    assert.equal(CARDS[77].zh, "錢幣國王");
    assert.equal(CARDS[77].en, "King of Pentacles");
  });

  test("每張牌的中英文名唯一", () => {
    assert.equal(new Set(CARDS.map(c => c.zh)).size, 78);
    assert.equal(new Set(CARDS.map(c => c.en)).size, 78);
  });

  test("每張牌都有正逆位關鍵字（至少 2 個，以「、」分隔，無空項）", () => {
    for (const c of CARDS) {
      for (const k of ["up", "rv"]) {
        const kws = c[k].split("、");
        assert.ok(kws.length >= 2, `${c.zh}.${k} 關鍵字不足`);
        assert.ok(kws.every(w => w.trim().length > 0), `${c.zh}.${k} 有空關鍵字`);
      }
    }
  });

  test("78 張都有專屬的正位與逆位建議（含 56 張小阿爾克那）", () => {
    for (const c of CARDS) {
      assert.equal(typeof c.upT, "string", `${c.zh} 缺 upT`);
      assert.equal(typeof c.rvT, "string", `${c.zh} 缺 rvT`);
      assert.ok(c.upT.length >= 15, `${c.zh} 正位建議太短`);
      assert.ok(c.rvT.length >= 15, `${c.zh} 逆位建議太短`);
      assert.notEqual(c.upT, c.rvT, `${c.zh} 正逆位建議相同`);
      assert.match(c.upT, /[。！]$/, `${c.zh} 正位建議應以句號結尾`);
      assert.match(c.rvT, /[。！]$/, `${c.zh} 逆位建議應以句號結尾`);
    }
  });

  test("156 段建議文字彼此不重複（沒有複製貼上）", () => {
    const all = CARDS.flatMap(c => [c.upT, c.rvT]);
    assert.equal(new Set(all).size, 156);
  });

  test("小阿爾克那深度與大牌一致：平均長度不低於大牌的 80%", () => {
    const avg = arr => arr.reduce((a, c) => a + c.upT.length + c.rvT.length, 0) / (arr.length * 2);
    const maj = avg(CARDS.filter(c => c.major)), min = avg(CARDS.filter(c => !c.major));
    assert.ok(min >= maj * 0.8, `小牌平均 ${min.toFixed(1)} 字 < 大牌 ${maj.toFixed(1)} 字的 80%`);
  });

  test("花色元素與代表色符合設計", () => {
    const want = { wands: ["火", "#a94b2a"], cups: ["水", "#2c6688"], swords: ["風", "#4b5674"], pentacles: ["土", "#6a7230"] };
    for (const s of SUITS) assert.deepEqual([s.el, s.color], want[s.key]);
    CARDS.filter(c => c.major).forEach(c => assert.equal(c.color, "#5a3f84"));
  });
});

describe("資料層：牌陣", () => {
  test("四種牌陣的張數：1 / 3 / 5 / 10", () => {
    assert.deepEqual(Object.fromEntries(Object.entries(SPREADS).map(([k, v]) => [k, v.pos.length])),
      { single: 1, three: 3, choice: 5, celtic: 10 });
  });

  test("每個位置都有名稱、意義，且欄列落在格線範圍內", () => {
    for (const [k, sp] of Object.entries(SPREADS)) {
      sp.pos.forEach((p, i) => {
        assert.ok(p.l && p.h, `${k}[${i}] 缺名稱或意義`);
        assert.ok(p.c >= 1 && p.c <= sp.cols, `${k}[${i}] 欄超出範圍`);
        assert.ok(p.r >= 1 && p.r <= sp.rows, `${k}[${i}] 列超出範圍`);
      });
    }
  });

  test("非橫放的牌位不會重疊在同一格", () => {
    for (const [k, sp] of Object.entries(SPREADS)) {
      const cells = sp.pos.filter(p => !p.x).map(p => `${p.c},${p.r}`);
      assert.equal(new Set(cells).size, cells.length, `${k} 有重疊牌位`);
    }
  });

  test("凱爾特十字：只有第 2 張橫放，且壓在第 1 張上", () => {
    const pos = SPREADS.celtic.pos;
    assert.deepEqual([...pos.map((p, i) => p.x ? i : -1).filter(i => i >= 0)], [1]);
    assert.equal(pos[1].c, pos[0].c);
    assert.equal(pos[1].r, pos[0].r);
  });

  test("凱爾特十字右側權杖由下往上：自我 → 環境 → 希望與恐懼 → 結果", () => {
    const staff = [...SPREADS.celtic.pos.slice(6)];
    assert.deepEqual(staff.map(p => p.l), ["自我", "環境", "希望與恐懼", "結果"]);
    assert.ok(staff.every(p => p.c === 4));
    assert.deepEqual(staff.map(p => p.r), [4, 3, 2, 1]);
  });

  test("二選一：現況在底部中央，A／B 分列左右", () => {
    const [now, aP, aR, bP, bR] = SPREADS.choice.pos;
    assert.deepEqual([now.c, now.r], [2, 3]);
    assert.ok(aP.c === 1 && aR.c === 1 && bP.c === 3 && bR.c === 3);
    assert.ok(aR.r < aP.r && bR.r < bP.r, "結果應在過程上方");
  });
});

describe("洗牌", () => {
  test("結果是 0–77 的完整排列，沒有遺漏或重複", () => {
    for (let k = 0; k < 50; k++) {
      const d = T.shuffle(true);
      assert.equal(d.length, 78);
      assert.deepEqual([...d.map(x => x.i)].sort((a, b) => a - b), [...Array(78).keys()]);
    }
  });

  test("關閉逆位時全部正位", () => {
    for (let k = 0; k < 20; k++) assert.ok(T.shuffle(false).every(d => d.rev === false));
  });

  test("開啟逆位時約 50% 逆位（20,000 張樣本，誤差 < 2%）", () => {
    let rev = 0, total = 0;
    for (let k = 0; k < 257; k++) { const d = T.shuffle(true); rev += d.filter(x => x.rev).length; total += d.length; }
    const ratio = rev / total;
    assert.ok(Math.abs(ratio - 0.5) < 0.02, `逆位比例 ${ratio.toFixed(3)}`);
  });

  test("Fisher–Yates 演算法：給定相同亂數序列，結果可重現", () => {
    assert.deepEqual(T.shuffle(true, seeded(42)), T.shuffle(true, seeded(42)));
    assert.notDeepEqual(T.shuffle(true, seeded(1)), T.shuffle(true, seeded(2)));
  });

  test("均勻性：「愚者」落在 78 個位置的機率相等（卡方檢定，α = 0.001）", () => {
    const N = 39000, bins = new Array(78).fill(0);
    for (let k = 0; k < N; k++) bins[T.shuffle(false).findIndex(d => d.i === 0)]++;
    const E = N / 78, chi = bins.reduce((a, o) => a + (o - E) ** 2 / E, 0);
    // 自由度 77，α = 0.001 的臨界值約 122.1
    assert.ok(chi < 122.1, `卡方值 ${chi.toFixed(1)} 過高，牌序可能有偏差`);
  });

  test("均勻性：抽出的第一張牌，78 張出現機率相等", () => {
    const N = 39000, bins = new Array(78).fill(0);
    for (let k = 0; k < N; k++) bins[T.shuffle(false)[0].i]++;
    const E = N / 78, chi = bins.reduce((a, o) => a + (o - E) ** 2 / E, 0);
    assert.ok(chi < 122.1, `卡方值 ${chi.toFixed(1)}`);
  });

  test("randInt 回傳 [0, n) 的整數；沒有 crypto 時退回 Math.random", () => {
    for (const n of [1, 2, 7, 78]) for (let k = 0; k < 500; k++) {
      const v = T.randInt(n); assert.ok(Number.isInteger(v) && v >= 0 && v < n);
    }
    const noCrypto = vm.createContext({ Math });
    vm.runInContext(m[1], noCrypto);
    for (let k = 0; k < 200; k++) { const v = noCrypto.Tarot.randInt(5); assert.ok(v >= 0 && v < 5); }
  });
});

describe("渲染層：牌面 SVG", () => {
  test("roman()：0、IV、IX、XIV、XIX、XXI", () => {
    assert.deepEqual([0, 4, 9, 14, 19, 21].map(T.roman), ["0", "IV", "IX", "XIV", "XIX", "XXI"]);
  });

  test("78 張牌面都能產生 SVG，含 10:16 viewBox 與牌名", () => {
    for (const c of CARDS) {
      const s = T.faceSVG(c);
      assert.ok(s.trim().startsWith("<svg"), `${c.zh} 不是 SVG`);
      assert.ok(s.includes('viewBox="0 0 100 160"'));
      assert.ok(s.includes(`>${c.zh}<`), `${c.zh} 牌面缺牌名`);
      assert.ok(!s.includes("undefined") && !s.includes("NaN"), `${c.zh} 牌面含 undefined/NaN`);
      assert.equal((s.match(/<svg/g) || []).length, (s.match(/<\/svg>/g) || []).length);
    }
  });

  test("數字牌依點數排列花色符號：王牌 1 個 … 十 10 個", () => {
    for (const c of CARDS.filter(c => !c.major && c.r < 10)) {
      const pips = (T.faceSVG(c).match(/class="pip"/g) || []).length;
      assert.equal(pips, c.r + 1, `${c.zh} 應有 ${c.r + 1} 個符號，實際 ${pips}`);
    }
  });

  test("宮廷牌：1 個大花色符號 + 1 個身分記號", () => {
    for (const c of CARDS.filter(c => !c.major && c.r >= 10)) {
      const s = T.faceSVG(c);
      assert.equal((s.match(/class="pip"/g) || []).length, 1);
      assert.equal((s.match(/class="mark"/g) || []).length, 1);
    }
    const mark = zh => T.faceSVG(CARDS[idxOf(zh)]).match(/<g class="mark">(.*?)<\/g>/)[1];
    assert.match(mark("聖杯侍者"), /^<circle/, "侍者是圓點");
    assert.match(mark("聖杯騎士"), /fill="none"/, "騎士是箭形線條");
    assert.match(mark("聖杯王后"), / A10,10 /, "王后是新月");
    assert.match(mark("聖杯國王"), /L50,33/, "國王是皇冠");
  });

  test("大阿爾克那：中央羅馬數字 + 16 道放射光芒", () => {
    for (const c of CARDS.filter(c => c.major)) {
      const s = T.faceSVG(c);
      assert.equal((s.match(/<line /g) || []).length, 16);
      assert.ok(s.includes(`>${T.roman(c.n)}</text>`));
    }
  });
});

describe("解讀", () => {
  test("interp() 依正逆位回傳每張牌的專屬建議", () => {
    for (const c of CARDS) {
      assert.equal(T.interp(c, false), c.upT);
      assert.equal(T.interp(c, true), c.rvT);
    }
  });

  test("單張：大牌與小牌說明不同，並評論正逆位", () => {
    const a = T.summaryLines([pick(0)]);
    assert.match(a[0], /大阿爾克那/);
    assert.match(a[1], /正位/);
    const b = T.summaryLines([pick(idxOf("聖杯三"), true)]);
    assert.match(b[0], /聖杯（水元素）/);
    assert.match(b[1], /逆位/);
  });

  test("大阿爾克那過半 → 人生課題、順勢而為", () => {
    const l = T.summaryLines([pick(0), pick(13), pick(idxOf("權杖二"))]);
    assert.match(l[0], /3 張牌中有 2 張大阿爾克那/);
    assert.match(l[0], /順勢/);
  });

  test("全為小阿爾克那 → 日常層面", () => {
    const l = T.summaryLines([pick(idxOf("權杖二")), pick(idxOf("聖杯七")), pick(idxOf("寶劍九"))]);
    assert.match(l[0], /全由小阿爾克那/);
  });

  test("同花色最多 → 指出主導元素；平手時不下結論", () => {
    const l = T.summaryLines([pick(idxOf("錢幣二")), pick(idxOf("錢幣八")), pick(idxOf("聖杯七"))]);
    assert.ok(l.some(x => /錢幣牌出現 2 張，土元素最強/.test(x)));
    const tie = T.summaryLines([pick(idxOf("錢幣二")), pick(idxOf("錢幣八")), pick(idxOf("聖杯七")), pick(idxOf("聖杯九"))]);
    assert.ok(!tie.some(x => /元素最強/.test(x)));
  });

  test("重複數字 → 點出數字主題（例：多張五 = 衝突與變動）", () => {
    const l = T.summaryLines([pick(idxOf("權杖五")), pick(idxOf("寶劍五")), pick(idxOf("錢幣五"))]);
    assert.ok(l.some(x => /出現 3 張「五」/.test(x) && /衝突與變動/.test(x)));
  });

  test("宮廷牌 ≥ 2 → 可能代表人或特質", () => {
    const l = T.summaryLines([pick(idxOf("權杖國王")), pick(idxOf("聖杯王后")), pick(0)]);
    assert.ok(l.some(x => /宮廷牌有 2 張/.test(x)));
  });

  test("逆位統計：0 張 / 少數 / 過半", () => {
    const ids = [1, 2, 3, 4];
    assert.ok(T.summaryLines(ids.map(i => pick(i))).some(x => /全部皆為正位/.test(x)));
    assert.ok(T.summaryLines(ids.map((i, k) => pick(i, k === 0))).some(x => /逆位 1 張/.test(x)));
    assert.ok(T.summaryLines(ids.map((i, k) => pick(i, k < 3))).some(x => /超過半數/.test(x)));
  });

  test("關閉逆位時，整體訊息不評論正逆位", () => {
    const l = T.summaryLines([pick(1), pick(2), pick(3)], false);
    assert.ok(!l.some(x => /正位|逆位/.test(x)));
    assert.equal(T.summaryLines([pick(1)], false).length, 1);
  });

  test("空牌陣不產生訊息", () => {
    assert.equal(T.summaryLines([]).length, 0);
  });

  test("readingText()：含標題、問題、每個位置與牌名、關鍵字與建議", () => {
    const picks = [pick(0), pick(idxOf("寶劍三"), true), pick(21)];
    const t = T.readingText("three", "  我在工作上需要注意什麼？ ", picks);
    assert.match(t, /^【夜航塔羅｜時間之流】/);
    assert.match(t, /問題：我在工作上需要注意什麼？\n/);
    assert.match(t, /1\. 過去：愚者（正位）/);
    assert.match(t, /2\. 現在：寶劍三（逆位）/);
    assert.ok(t.includes(CARDS[idxOf("寶劍三")].rvT));
    assert.match(t, /3\. 未來：世界（正位）/);
    assert.ok(!T.readingText("single", "", [pick(5)]).includes("問題："), "空問題不輸出問題列");
  });

  test("任意隨機牌陣都能產生完整解讀（各牌陣 200 次）", () => {
    for (const [k, sp] of Object.entries(SPREADS)) for (let n = 0; n < 200; n++) {
      const picks = T.shuffle(true).slice(0, sp.pos.length);
      const lines = T.summaryLines(picks);
      assert.ok(lines.length >= 1 && lines.every(x => typeof x === "string" && x.length > 0));
      const t = T.readingText(k, "", picks);
      assert.ok(!t.includes("undefined"), `${k} 解讀文字含 undefined`);
    }
  });
});
