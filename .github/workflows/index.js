import { chromium } from "playwright";

const URL = "https://www.hit789.com/resulthuay";
const PAGE_TIMEOUT = 45000;

// จัดหมวด 3 หลัก
const isTriple = s => /^(\d)\1\1$/.test(s);                 // ตอง AAA
const isHarm   = s => /^(\d)\d\1$/.test(s);                 // หาม ABA
const isDouble = s => (new Set(s.split(""))).size === 2 && !isTriple(s); // เบิ้ล AAB/ABB

async function sendLineSafe(text) {
  const token = process.env.LINE_TOKEN;
  const to = process.env.LINE_TO;
  if (!token) { console.log("SKIP LINE: no LINE_TOKEN"); return; }

  try {
    const endpoint = to
      ? "https://api.line.me/v2/bot/message/push"
      : "https://api.line.me/v2/bot/message/broadcast";

    const payload = to
      ? { to, messages: [{ type: "text", text }] }
      : { messages: [{ type: "text", text }] };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.text();
    console.log("LINE status:", res.status, body || "(empty)");
    // อย่า throw เพื่อไม่ให้ workflow ล้ม แม้ LINE จะ error
  } catch (e) {
    console.error("LINE send error:", e?.message || e);
    // ไม่ throw
  }
}

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox","--disable-dev-shm-usage"] });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });

  console.log("Goto page...");
  await page.goto(URL, { waitUntil: "networkidle", timeout: PAGE_TIMEOUT });

  // คลิก “มุมมองยาว” แบบหลาย fallback
  console.log("Try click Long view...");
  let clicked = false;
  try {
    const cand = [
      page.getByRole("button", { name: /มุมมองยาว/i }),
      page.getByText(/มุมมองยาว/i, { exact: false }),
      page.locator("text=มุมมองยาว")
    ];
    for (const loc of cand) {
      if (await loc.first().isVisible({ timeout: 3000 }).catch(()=>false)) {
        await loc.first().click({ timeout: 3000 });
        clicked = true; break;
      }
    }
  } catch { /* ignore */ }
  console.log("Long view clicked:", clicked);

  // รอให้ตาราง “3ตัวบน” โผล่
  console.log("Wait table...");
  await page.waitForTimeout(1000);
  await page.waitForFunction(() => {
    const clean = s => s?.textContent?.replace(/\s+/g,'') || '';
    return Array.from(document.querySelectorAll("table,div"))
      .some(e => /3ตัวบน|สามตัวบน/.test(clean(e)));
  }, { timeout: 20000 }).catch(() => {});

  // ดึงค่า “3 ตัวบน” ทั้งหมด
  console.log("Extract rows...");
  const rows = await page.evaluate(() => {
    const out = [];
    const txt = n => (n?.innerText || n?.textContent || "").trim();
    const tables = Array.from(document.querySelectorAll("table"));
    for (const table of tables) {
      const thead = table.tHead || table.querySelector("thead");
      const tbody = table.tBodies?.[0] || table.querySelector("tbody");
      if (!thead || !tbody) continue;
      const headers = Array.from(thead.rows?.[0]?.cells || []).map(txt).map(t=>t.replace(/\s+/g,''));
      const idxTop3  = headers.findIndex(h => /^(3ตัวบน|สามตัวบน)$/i.test(h));
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
  if (!rows.length) { console.log("No data. End."); return; }

  // กรองเฉพาะ “ตอง/หาม/เบิ้ล”
  const special = rows.map(r => {
    const s = r.top3;
    if (isTriple(s)) return { ...r, type: "ตอง" };
    if (isHarm(s))   return { ...r, type: "หาม" };
    if (isDouble(s)) return { ...r, type: "เบิ้ล" };
    return null;
  }).filter(Boolean);

  console.log("Special found:", special.length);
  if (!special.length) { console.log("Nothing matches. End."); return; }

  // สรุปข้อความและส่ง LINE (ไม่ทำให้งานล้มแม้ส่งไม่สำเร็จ)
  const lines = special.slice(0, 5).map(r => `• รอบ ${r.round} | ${r.type}: ${r.top3}`).join("\n");
  const when = new Date().toLocaleString("th-TH");
  await sendLineSafe(`มุมมองยาว: 3 ตัวบนเข้าเงื่อนไข\n${lines}\nอัปเดต: ${when}`);
})().catch(err => {
  console.error("FATAL:", err?.message || err);
  // ไม่ throw เพื่อกันล้ม; ให้ workflow ผ่านแม้ scrape fail ครั้งแรก
});
