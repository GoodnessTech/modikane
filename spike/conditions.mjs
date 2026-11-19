// Lagos conditions, applied from OUTSIDE the app so the app can't cheat:
//  1. Network: a local proxy adds latency and can drop the connection
//     *after* the server has processed a request (the "debit alert, no credit" case).
//  2. Device: a Chrome we launch ourselves, emulating a mid-range Android phone.
//     Kane CLI then attaches to this Chrome with --cdp-endpoint.
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";

export const PROFILES = {
  "lagos-3g": { latencyMs: 400, dropOnce: null },
  "lagos-drop-mid-transfer": { latencyMs: 400, dropOnce: /^POST \/api\/transfer$/ },
};

export const PHONE = {
  width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 13; Infinix X6833B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
  cpuSlowdown: 4,
};

// ---------- 1. network proxy ----------
export function startProxy({ listenPort, targetPort, latencyMs, dropOnce, log = console.log }) {
  let dropped = false;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const server = http.createServer(async (req, res) => {
    await sleep(latencyMs);
    const sig = `${req.method} ${req.url.split("?")[0]}`;
    const shouldDrop = dropOnce && !dropped && dropOnce.test(sig);
    const up = http.request({ host: "127.0.0.1", port: targetPort, method: req.method, path: req.url, headers: req.headers }, upRes => {
      if (shouldDrop) {
        dropped = true;
        upRes.resume(); // server finished its work (money moved)...
        upRes.on("end", () => { log(`[net] DROPPED response to ${sig} after server processed it`); req.socket.destroy(); });
        return;
      }
      upRes.pause();
      setTimeout(() => { res.writeHead(upRes.statusCode, upRes.headers); upRes.pipe(res); }, latencyMs);
    });
    up.on("error", e => { res.writeHead(502); res.end(String(e)); });
    req.pipe(up);
  });
  return new Promise(r => server.listen(listenPort, () => { log(`[net] proxy :${listenPort} -> :${targetPort}, +${latencyMs}ms each way${dropOnce ? ", drop once: " + dropOnce : ""}`); r(server); }));
}

// ---------- 2. emulated phone in a Chrome we own ----------
export function findChrome() {
  const c = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const hit = c.find(p => { try { return fs.existsSync(p); } catch { return false; } });
  if (!hit) throw new Error("Chrome not found. Set CHROME_PATH to chrome.exe");
  return hit;
}

async function waitForPort(port, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const ok = await new Promise(r => { const s = net.connect(port, "127.0.0.1", () => { s.end(); r(true); }); s.on("error", () => r(false)); });
    if (ok) return;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Chrome debugging port ${port} never opened`);
}

export async function startPhoneChrome({ port = 9222, headless = false, log = console.log } = {}) {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "modikane-chrome-"));
  const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`, "--no-first-run",
    "--no-default-browser-check", `--window-size=${PHONE.width + 16},${PHONE.height + 120}`];
  if (headless) args.push("--headless=new");
  if (process.platform === "linux") args.push("--no-sandbox");
  const proc = spawn(findChrome(), args, { stdio: "ignore" });
  await waitForPort(port);
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null });

  // Chrome lets the MOST RECENTLY attached DevTools connection decide the screen size.
  // Kane attaches after us and sets a 1920px desktop screen, so a one-time setup loses.
  // Fix: a watchdog checks each tab; if it isn't phone-sized, it opens a FRESH connection
  // (now the newest) and re-applies the phone. Tested: the phone then survives Kane's
  // navigations and Kane's own attempts to set 1920px again.
  const sessions = [];
  const applyPhone = async page => {
    const s = await page.createCDPSession(); sessions.push(s);
    await s.send("Emulation.setDeviceMetricsOverride", { width: PHONE.width, height: PHONE.height, deviceScaleFactor: PHONE.deviceScaleFactor, mobile: true });
    await s.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await s.send("Emulation.setUserAgentOverride", { userAgent: PHONE.userAgent, platform: "Linux armv8l" });
    await s.send("Emulation.setCPUThrottlingRate", { rate: PHONE.cpuSlowdown });
  };
  const checking = new WeakSet();
  let reapplied = 0, stopped = false;
  const check = async page => {
    if (!/^https?:/.test(page.url()) || checking.has(page)) return; checking.add(page);
    try {
      const width = await page.evaluate(() => window.innerWidth).catch(() => null);
      if (width !== null && width !== PHONE.width) {
        await applyPhone(page); reapplied++;
        log(`[device] tab was ${width}px wide, re-applied ${PHONE.width}px phone (${page.url()})`);
      }
    } catch {} finally { checking.delete(page); }
  };
  for (const p of await browser.pages()) await applyPhone(p).catch(() => {});
  // Every new tab starts as a phone immediately; the watchdog then guards it.
  browser.on("targetcreated", async t => {
    if (t.type() !== "page") return;
    const p = await t.page().catch(() => null); if (p) await applyPhone(p).catch(() => {});
  });
  const watchdog = setInterval(async () => {
    if (stopped) return;
    for (const p of await browser.pages().catch(() => [])) check(p);
  }, 250);

  return {
    cdpEndpoint: `http://127.0.0.1:${port}`,
    browser,
    get reapplied() { return reapplied; },
    async stop() { stopped = true; clearInterval(watchdog); try { await browser.disconnect(); } catch {} proc.kill(); },
  };
}
