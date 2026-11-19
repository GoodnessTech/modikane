// modikane doctor: a free check that everything Modikane needs works, without spending Kane credits.
import { spawn } from "node:child_process";
import { startProxy } from "./proxy.mjs";
import { startPhone, findChrome } from "./phone.mjs";
import { startApp, freePort } from "./app.mjs";
import { kaneCommand } from "./kane.mjs";
import { CONDITIONS, PHONE } from "./conditions.mjs";

const run = (k, ms = 30000) => new Promise(resolve => {
  let out = "";
  let child;
  try { child = spawn(k.cmd, k.args, { shell: !!k.shell, stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { return resolve({ code: -1, out: e.message }); }
  const t = setTimeout(() => child.kill(), ms);
  child.stdout.on("data", d => (out += d)); child.stderr.on("data", d => (out += d));
  child.on("error", e => { clearTimeout(t); resolve({ code: -1, out: e.message }); });
  child.on("close", code => { clearTimeout(t); resolve({ code, out: out.trim() }); });
});

export async function doctor({ cfg, headless, log }) {
  let ok = true;
  const pass = m => log(`  ✓ ${m}`);
  const fail = m => { ok = false; log(`  ✗ ${m}`); };

  log("Modikane doctor (no Kane credits used)\n");
  try { pass(`Chrome: ${findChrome()}`); } catch (e) { fail(e.message); }

  const v = await run(kaneCommand(["--version"]));
  if (v.code === 0) pass(`Kane CLI ${v.out.split(/\s+/).pop()} (${kaneCommand([]).how})`);
  else fail("Kane CLI not found. Install it: npm install -g @testmuai/kane-cli, then kane-cli login");

  let app, proxy, phone;
  try {
    app = await startApp(cfg.app, cfg.dir, () => {});
    pass(`app ${app.started ? "started" : "is running"} on port ${cfg.app.port}`);
    const c = CONDITIONS["slow-3g"];
    proxy = await startProxy({ listenPort: await freePort(), targetPort: cfg.app.port, latencyMs: c.latencyMs });
    const t0 = Date.now(); await fetch(`http://127.0.0.1:${proxy.port}${cfg.app.ready}`).then(r => r.text());
    const ms = Date.now() - t0;
    ms >= c.latencyMs * 2 ? pass(`slow 3G: a request took ${ms}ms through the network proxy`) : fail(`slow 3G: request took only ${ms}ms`);

    phone = await startPhone({ port: await freePort(), headless });
    const page = await phone.browser.newPage();
    // Act like Kane: force a desktop screen, then load the app. The watchdog must win.
    const s = await page.createCDPSession();
    await s.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await page.goto(`http://127.0.0.1:${proxy.port}${cfg.flows[0]?.path || "/"}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise(r => setTimeout(r, 1500));
    const scr = await page.evaluate(() => ({ w: window.innerWidth, android: navigator.userAgent.includes("Android") }));
    scr.w === PHONE.width && scr.android
      ? pass(`phone: app renders at ${scr.w}px on Android, even after a forced 1920px desktop screen`)
      : fail(`phone: app rendered at ${scr.w}px ${scr.android ? "Android" : "Desktop"}`);
    pass(`drop-after-commit: armed (the first ${cfg.drop_match ? `request matching ${cfg.drop_match}` : "POST/PUT/PATCH/DELETE"} in each run will lose its reply)`);
  } catch (e) {
    fail(e.message);
  } finally {
    await phone?.stop().catch(() => {}); await proxy?.close().catch(() => {}); await app?.stop().catch(() => {});
  }

  log(`\n  flows: ${cfg.flows.map(f => f.name).join(", ")} · conditions: ${cfg.conditions.join(", ")}`);
  log(`  a full check = ${cfg.flows.length * cfg.conditions.length} Kane run(s), about ${cfg.flows.length * cfg.conditions.length * 36} credits`);
  log(ok ? "\nReady. Run `modikane check`." : "\nFix the ✗ items above first.");
  return ok;
}
