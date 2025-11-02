import { chromium } from "playwright";

const URL = "https://www.hit789.com/resulthuay";
const PAGE_TIMEOUT = 60000;

const isTriple = s => /^(\d)\1\1$/.test(s);
const isHarm   = s => /^(\d)\d\1$/.test(s);
const isDouble = s => (new Set(s.split(""))).size === 2 && !isTriple(s);

async function sendLineSafe(text) {
  const token = process.env.LINE_TOKEN, to = process.env.LINE_TO;
  if (!token) { console.log("SKIP LINE: no LINE_TOKEN"); return; }
  try {
    const endpoint = to ? "https://api.line.me/v2/bot/message/push"
                        : "https://api.line.me/v2/bot/message/broadcast";
    const body = to ? { to, messages: [{ type: "text", text }] }
                    : { messages: [{ type: "text", text }] };
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    console.log("LINE status:", r.status, await r.text().catch(()=>"(no text)"));
  } catch (e) { console.log("LINE send error:", e?.message || e); }
}

(async () => {
  const browser = await chromium.launch({
    args: ["--no-sandbox","--disable-dev-shm-usage","--disable-blink-features=AutomationControlled"],
    ignoreHTTPSErrors: true,
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    locale: "th-TH",
  });
  const page = await context.newPage();
  page.on("console", m => console.log("PAGE:", m.type(), m.text()));

  console.log("Goto page...");
  await page.goto(URL, { waitUntil: "networkidle", timeout: PAGE_TIMEOUT });

  console.log("Try click Long view…");
  let clicked = false;
  const candidates = [
    page.getByRole("button", { name: /มุมมองยาว/i }),
    page.getByText(/มุมมองยาว/i, { exact: false }),
    page.locator("text=มุมมองยาว")
  ];
  for (const loc of candidates) {
    try {
      const el = loc.first();
      if (await el.isVisible({ timeout: 2000 })) { await el.click({ timeout: 3000 }); clicked = true; break; }
    } catch {}
  }
  console.log("Long view clicked:", clicked);

  console.log("Wait table…");
  await page.waitForTimeout(1200);
  await page.waitForFunction(() => {
    const clean = s => s?.textContent?.replace(/\s+/g,'') || '';
    return Array.from(document.querySelectorAll("table,div")).some(e => /3ตัวบน|สามตัวบน/.test(clean(e)));
  }, { timeout: 25000 }).catch(()=>{});

  console.log("Extract rows…");
  const rows = await page.evaluate(() => {
    const out = []; const txt = n => (n?.innerText || n?.textContent || "").trim();
    const tables = Array.from(document.querySelectorAll("table"));
    for (const table of tables) {
      const thead = table.tHead || table.querySelector("thead");
      const tbody = table.tBodies?.[0] || table.querySelector("tbody");
      if (!thead || !tbody) continue;
      const headers = Array.from(thead.rows?.[0]?.cells || []).map(txt).map(t=>t.replace(/\s+/g,''));
      const idxTop3 = headers.findIndex(h => /^(3ตัวบน|สามตัวบน)$/i.test(h));
      const idxRound = headers.findIndex(h => /^รอบ$/i.test(h));
      if (idxTop3 === -1) continue;
      for (const tr of Array.from(tbody.rows)) {
        const cells = Array.from(tr.cells);
        const round = idxRound !== -1 ? txt(cells[idxRound]) : txt(cells[0]);
        const top3  = txt(cells[idxTop3]).replace(/\D/g,'');
        if (/^\d{3}$/.test(top3)) out.push({ round, top3 });
      }
    }
    return out;
  });

  await browser.close();

  console.log("Rows found:", rows.length);
  if (!rows.length) return;

  const special = rows.map(r => {
    const s = r.top3;
    if (isTriple(s)) return { ...r, type: "ตอง" };
    if (isHarm(s))   return { ...r, type: "หาม" };
    if (isDouble(s)) return { ...r, type: "เบิ้ล" };
    return null;
  }).filter(Boolean);

  console.log("Special found:", special.length);
  if (!special.length) return;

  const lines = special.slice(0, 5).map(r => `• รอบ ${r.round} | ${r.type}: ${r.top3}`).join("\n");
  await sendLineSafe(`มุมมองยาว: 3 ตัวบนเข้าเงื่อนไข\n${lines}\nอัปเดต: ${new Date().toLocaleString("th-TH")}`);
})().catch(e => console.log("FATAL:", e?.message || e));
