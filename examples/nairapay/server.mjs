// NairaPay: a tiny Nigerian wallet app with a PLANTED BUG, used as Modikane's example.
// Bug: no idempotency. If the network drops after the server debits you,
// the page says "failed", the user taps Send again, and gets debited twice.
// Run with FIXED=1 to get the corrected behaviour (idempotency key + status check).
import http from "node:http";

const FIXED = process.env.FIXED === "1";
const PORT = Number(process.env.PORT || process.env.SHOP_PORT || 4000);

let balance = 20000;
const transfers = []; // { id, key, to, amount, at }
const screensSeen = []; // what every page load actually rendered at: "412px wide · Android"

const page = () => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NairaPay</title>
<style>
 body{font-family:system-ui,sans-serif;margin:0;background:#f4f6f5;color:#122}
 header{background:#0b6e4f;color:#fff;padding:14px 16px;font-weight:700}
 main{padding:16px;max-width:480px;margin:auto}
 .card{background:#fff;border-radius:12px;padding:16px;margin-bottom:12px}
 label{display:block;font-size:14px;margin:10px 0 4px}
 input{width:100%;box-sizing:border-box;padding:12px;font-size:16px;border:1px solid #ccd;border-radius:8px}
 button{width:100%;padding:14px;margin-top:14px;font-size:16px;border:0;border-radius:8px;background:#0b6e4f;color:#fff}
 #msg{margin-top:12px;font-weight:600}
 nav a{color:#fff;margin-left:12px}
 footer{font-size:12px;color:#667;text-align:center;padding:12px}
</style></head><body>
<header>NairaPay <nav style="float:right"><a href="/">Send</a><a href="/history">History</a></nav></header>
<main>
 <div class="card">Balance: <b id="bal">₦${balance.toLocaleString()}</b></div>
 <div class="card">
  <label for="to">Recipient</label><input id="to" value="Chidi">
  <label for="amt">Amount (₦)</label><input id="amt" inputmode="numeric" value="5000">
  <button id="send">Send money</button>
  <div id="msg" role="status"></div>
 </div>
</main>
<footer id="env"></footer>
<script>
 const screenNow = () => window.innerWidth + 'px wide · ' + (navigator.userAgent.includes('Android') ? 'Android' : 'Desktop');
 const report = () => { document.getElementById('env').textContent = 'Screen: ' + screenNow(); fetch('/api/env?s=' + encodeURIComponent(screenNow())).catch(() => {}); };
 report(); let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(report, 150); });
 const msg = document.getElementById('msg');
 let key = null;
 document.getElementById('send').onclick = async () => {
  const body = { to: document.getElementById('to').value, amount: Number(document.getElementById('amt').value), screen: screenNow() };
  ${FIXED ? "key = key || crypto.randomUUID(); body.key = key;" : ""}
  msg.textContent = 'Sending…';
  try {
   const r = await fetch('/api/transfer', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
   const j = await r.json();
   msg.textContent = 'Sent ₦' + j.amount.toLocaleString() + ' to ' + j.to + '.';
   document.getElementById('bal').textContent = '₦' + j.balance.toLocaleString();
   key = null;
  } catch (e) {
   ${FIXED
     ? `msg.textContent = 'Connection lost. Checking whether your transfer went through…';
   for (let i = 0; i < 10; i++) {
    try {
     const s = await (await fetch('/api/transfer-status?key=' + key)).json();
     if (s.found) { msg.textContent = 'Your transfer went through. Sent ₦' + s.amount.toLocaleString() + ' to ' + s.to + '.'; key = null; return; }
     msg.textContent = 'Transfer did not go through. You can try again.'; return;
    } catch { await new Promise(r => setTimeout(r, 1000)); }
   }`
     : `msg.textContent = 'Transfer failed. Please try again.';`}
  }
 };
</script></body></html>`;

const historyPage = () => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>History</title>
<style>body{font-family:system-ui,sans-serif;padding:16px} li{margin:6px 0}</style></head><body>
<h1>History</h1>
<p>Balance: <b>₦${balance.toLocaleString()}</b></p>
<p>Transfers: <b id="count">${transfers.length}</b></p>
<ul>${transfers.map(t => `<li>₦${t.amount.toLocaleString()} to ${t.to} <small>(sent from ${t.screen || "?"})</small></li>`).join("")}</ul>
<a href="/">Back</a></body></html>`;

const json = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "GET" && url.pathname === "/") { res.writeHead(200, { "content-type": "text/html" }); return res.end(page()); }
  if (req.method === "GET" && url.pathname === "/history") { res.writeHead(200, { "content-type": "text/html" }); return res.end(historyPage()); }
  if (req.method === "GET" && url.pathname === "/api/state") return json(res, 200, { balance, transfers, screensSeen });
  if (req.method === "GET" && url.pathname === "/api/env") { screensSeen.push(String(url.searchParams.get("s")).slice(0, 80)); return json(res, 200, { ok: true }); }
  if (req.method === "GET" && url.pathname === "/api/transfer-status") {
    const t = transfers.find(t => t.key && t.key === url.searchParams.get("key"));
    return json(res, 200, t ? { found: true, ...t } : { found: false });
  }
  if (req.method === "POST" && url.pathname === "/api/reset") { balance = 20000; transfers.length = 0; return json(res, 200, { ok: true }); }
  if (req.method === "POST" && url.pathname === "/api/transfer") {
    let raw = ""; req.on("data", c => (raw += c)); req.on("end", () => {
      const { to, amount, key, screen } = JSON.parse(raw || "{}");
      const existing = FIXED && key ? transfers.find(t => t.key === key) : null;
      if (existing) return json(res, 200, { ...existing, balance });
      balance -= amount; // the debit happens here, before the response is sent
      const t = { id: transfers.length + 1, key, to, amount, screen, at: Date.now() };
      transfers.push(t);
      json(res, 200, { ...t, balance });
    });
    return;
  }
  res.writeHead(404); res.end();
}).listen(PORT, () => console.log(`[shop] NairaPay on http://localhost:${PORT} (${FIXED ? "FIXED" : "BUGGY"})`));
