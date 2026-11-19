// The phone: a Chrome we launch, emulating a mid-range Android phone. Kane attaches to it
// with --cdp-endpoint.
//
// Chrome lets the MOST RECENTLY attached DevTools connection control screen size, and Kane
// attaches after us and forces a 1920px desktop screen. So a watchdog checks every web page;
// when one isn't phone-sized it opens a FRESH connection (now the newest) and re-applies the
// phone. Verified on Windows in the day-1 spike: every tap happened at 412px.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";
import { PHONE } from "./conditions.mjs";

export function findChrome() {
  const c = [
    process.env.CHROME_PATH, process.env.KANE_CLI_CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const hit = c.find(p => { try { return fs.existsSync(p); } catch { return false; } });
  if (!hit) throw new Error("Google Chrome not found. Set CHROME_PATH to the Chrome executable.");
  return hit;
}

export async function waitForPort(port, ms = 20000, host = "127.0.0.1") {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const ok = await new Promise(r => { const s = net.connect(port, host, () => { s.end(); r(true); }); s.on("error", () => r(false)); });
    if (ok) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

export async function startPhone({ port = 9222, headless = false } = {}) {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "modikane-chrome-"));
  const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`, "--no-first-run",
    "--no-default-browser-check", `--window-size=${PHONE.width + 16},${PHONE.height + 120}`];
  if (headless) args.push("--headless=new");
  if (process.platform === "linux") args.push("--no-sandbox");
  const proc = spawn(findChrome(), args, { stdio: "ignore" });
  if (!(await waitForPort(port))) { proc.kill(); throw new Error(`Chrome debugging port ${port} never opened`); }
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null });

  const sessions = [];
  const applyPhone = async page => {
    const s = await page.createCDPSession(); sessions.push(s);
    await s.send("Emulation.setDeviceMetricsOverride", { width: PHONE.width, height: PHONE.height, deviceScaleFactor: PHONE.deviceScaleFactor, mobile: true });
    await s.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await s.send("Emulation.setUserAgentOverride", { userAgent: PHONE.userAgent, platform: "Linux armv8l" });
    await s.send("Emulation.setCPUThrottlingRate", { rate: PHONE.cpuSlowdown });
  };
  let restores = 0, stopped = false;
  const checking = new WeakSet();
  const check = async page => {
    if (!/^https?:/.test(page.url()) || checking.has(page)) return; checking.add(page);
    try {
      const w = await page.evaluate(() => window.innerWidth).catch(() => null);
      if (w !== null && w !== PHONE.width) { await applyPhone(page); restores++; }
    } catch {} finally { checking.delete(page); }
  };
  for (const p of await browser.pages()) await applyPhone(p).catch(() => {});
  browser.on("targetcreated", async t => {
    if (t.type() !== "page") return;
    const p = await t.page().catch(() => null); if (p) await applyPhone(p).catch(() => {});
  });
  const watchdog = setInterval(async () => {
    if (stopped) return;
    for (const p of await browser.pages().catch(() => [])) check(p);
  }, 100);

  // Screen width of every open web page, right now. Used to prove each write happened on a phone.
  const screens = async () => {
    const out = [];
    for (const p of await browser.pages().catch(() => [])) {
      if (!/^https?:/.test(p.url())) continue;
      const s = await p.evaluate(() => ({ w: window.innerWidth, android: navigator.userAgent.includes("Android") })).catch(() => null);
      if (s) out.push(s);
    }
    return out;
  };

  return {
    cdpEndpoint: `http://127.0.0.1:${port}`,
    browser, screens,
    get restores() { return restores; },
    async stop() {
      stopped = true; clearInterval(watchdog);
      try { await browser.disconnect(); } catch {}
      proc.kill();
      setTimeout(() => { try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {} }, 1500).unref();
    },
  };
}
