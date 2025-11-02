import { chromium } from "playwright";

const URL = "https://www.hit789.com/resulthuay";

// จัดหมวด 3 หลัก
const isTriple = s => /^(\d)\1\1$/.test(s);                      // ตอง AAA
const isHarm   = s => /^(\d)\d\1$/.test(s);                      // หาม ABA
const isDouble = s => (new Set(s.split(""))).size === 2 && !isTriple(s); // เบิ้ล AAB/ABB

async function sendLine(text) {
  const token = process.env.LINE_TOKEN;
  if (!token) throw new Error("Missing LINE_TOKEN");
  const to = process.env.LINE_TO;

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
  if (!res.ok) throw new Error(`LINE API ${res.status}: ${await res.text()}`);
}

function uniqBy(arr, keyFn) {
  const seen = new Set();
  return arr.filter(x => {
    const k = keyFn(x);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox","--disable-dev-shm-usage"] });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });

  // 1) เปิดหน้า
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  // 2) คลิก “มุมมองยาว” (มี fallback)
  try {
    await page.getByText(/มุมมองยาว/i, { exact: false }).first().click({ timeout: 5000 });
  } catch {
    const cand = await page.$$('button,[role="tab"],a,div');
    for (const el of cand) {
      const t = (await el.innerText().catch(()=>''))?.trim();
      if (t && /มุมมองยาว/.test(t)) { await el.click(); break; }
    }
  }

  // 3) รอตารางแสดงผล
  await page.waitForTimeout(800);
  await page.waitForFunction(() => {
    const clean = s => s?.textContent?.replace(/\s+/g,'') || '';
    return Array.from(document.querySelectorAll("table,div"))
      .some(e => /3ตัวบน|สามตัวบน/.test(clean(e)));
  }, { timeout: 15000 });

  // 4) ดึงค่า “3 ตัวบน” ทุกแถวจากตารางมุมมองยาว
  const rows = await page.evaluate(() => {
    const out = [];
    const getText = n => (n?.innerText || n?.textContent || "").trim();
    const tables = Array.from(document.querySelectorAll("table"));

    for (const table of tables) {
      const thead = table.tHead || table.querySelector("thead");
      const tbody = table.tBodies?.[0] || table.querySelector("tbody");
      if (!thead || !tbody) continue;

      const headers = Array.from(thead.rows[0].cells).map(getText).map(t => t.replace(/\s+/g,''));
      const idxTop3  = headers.findIndex(h => /^(3ตัวบน|สามตัวบน)$/i.test(h));
      const idxRound = headers.findIndex(h => /^รอบ$/i.test(h));
      if (idxTop3 === -1) continue;

      for (const tr of Array.from(tbody.rows)) {
        const cells = Array.from(tr.cells);
        const round = idxRound !== -1 ? getText(cells[idxRound]) : getText(cells[0]);
        const top3  = getText(cells[idxTop3]).replace(/\D/g,'');
        if (/^\d{3}$/.test(top3)) out.push({ round, top3 });
      }
    }
    return out;
  });

  await browser.close();

  if (!rows.length) {
    console.log("ไม่พบตารางมุมมองยาว/3ตัวบน");
    return;
  }

  // 5) คัดเฉพาะ “ตอง/หาม/เบิ้ล” และตัดซ้ำ
  const special = rows.map(r => {
    const s = r.top3;
    if (isTriple(s)) return { ...r, type: "ตอง" };
    if (isHarm(s))   return { ...r, type: "หาม" };
    if (isDouble(s)) return { ...r, type: "เบิ้ล" };
    return null;
  }).filter(Boolean);

  if (!special.length) {
    console.log("ไม่มีค่า 3 ตัวบนที่เข้าเงื่อนไข");
    return;
  }

  // ส่งเฉพาะรายการล่าสุด 1–3 แถว (กันยาวเกิน)
  const latest = uniqBy(special.slice(0, 3), x => x.top3 + "|" + x.type);
  const lines = latest.map(r => `• รอบ ${r.round} | ${r.type}: ${r.top3}`).join("\n");
  const when = new Date().toLocaleString("th-TH");
  await sendLine(`มุมมองยาว: 3 ตัวบนเข้าเงื่อนไข\n${lines}\nอัปเดต: ${when}`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
