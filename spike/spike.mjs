// Modikane day-1 spike.
//   node spike.mjs            -> Kane CLI runs the flow on an emulated Android phone, with the network dropping mid-transfer
//   node spike.mjs --dry      -> same conditions, but a scripted "user" instead of Kane (no credits used)
//   set FIXED=1 (Windows: `set FIXED=1`, PowerShell: `$env:FIXED=1`) to run against the fixed app
//
// What we must learn: (1) does Kane attach to our phone Chrome, (2) does it see a 412px Android screen,
// (3) does it catch the double debit on the buggy app and pass on the fixed app?
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PROFILES, startProxy, startPhoneChrome } from "./conditions.mjs";

const DRY = process.argv.includes("--dry");
const HEADLESS = process.argv.includes("--headless");
const SHOP = 4000, PROXY = 5000;
const URL = `http://localhost:${PROXY}`;

const OBJECTIVE =
  `Open ${URL}. ` +
  `Send 5000 naira to Chidi using the form. ` +
  `If the page says the transfer failed, tap Send money once more, like a real user would. ` +
  `Wait until the page shows a final message. ` +
  `Then open the History page and store the number of transfers as 'transfer_count' and the balance as 'balance'. ` +
  `Check that there is exactly 1 transfer and the balance is 15,000 naira.`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const shop = spawn(process.execPath, ["shop.mjs"], { stdio: "inherit", env: { ...process.env, SHOP_PORT: String(SHOP) } });
  await sleep(800);
  const { latencyMs, dropOnce } = PROFILES["lagos-drop-mid-transfer"];
  const proxy = await startProxy({ listenPort: PROXY, targetPort: SHOP, latencyMs, dropOnce });
  const phone = await startPhoneChrome({ headless: HEADLESS });
  console.log(`[spike] phone Chrome ready at ${phone.cdpEndpoint}`);

  let verdict;
  try {
    verdict = DRY ? await scriptedUser(phone.browser) : await runKane(phone.cdpEndpoint);
  } finally {
    const truth = await (await fetch(`http://localhost:${SHOP}/api/state`)).json();
    console.log("\n================ MODIKANE SPIKE RESULT ================");
    console.log("Server truth  :", `${truth.transfers.length} transfer(s), balance ₦${truth.balance.toLocaleString()}`);
    console.log("Phone check   :", truth.transfers.length
      ? truth.transfers.map(t => `transfer #${t.id} tapped on a ${t.screen}`).join(" | ")
      : "no transfer was made");
    console.log("Screens seen  :", [...new Set(truth.screensSeen)].join(" -> ") || "none reported");
    console.log("Phone fixes   :", `watchdog re-applied the phone screen ${phone.reapplied} time(s)`);
    const tapped = truth.transfers.map(t => t.screen || "");
    if (tapped.length) console.log(tapped.every(s => s.startsWith("412px") && s.includes("Android"))
      ? "=> PHONE OK: every Send tap happened on a 412px Android screen."
      : "=> PHONE NOT OK: at least one Send tap happened on a non-phone screen.");
    if (verdict) console.log("Verifier said :", JSON.stringify(verdict, null, 2));
    if (verdict && verdict.exit_code !== undefined && verdict.exit_code >= 2)
      console.log(`=> INCONCLUSIVE: Kane errored or timed out (exit ${verdict.exit_code}) before giving a verdict. Check the Kane output above.`);
    else
      console.log(truth.transfers.length > 1 ? "=> Double debit happened. Kane should have FAILED this run." : "=> No double debit. Kane should have PASSED this run.");
    console.log("========================================================\n");
    await phone.stop(); proxy.close(); shop.kill();
    process.exit(0);
  }
}

// Drives the flow with Kane CLI in --agent mode and returns its run_end event.
function runKane(cdpEndpoint) {
  return new Promise((resolve, reject) => {
    const args = ["run", OBJECTIVE, "--agent", "--cdp-endpoint", cdpEndpoint, "--mode", "testing", "--timeout", "300", "--max-steps", "40"];
    const k = kaneCommand(args);
    console.log(`[kane] launching via ${k.how}`);
    console.log(`[kane] objective (sent as ONE argument): ${OBJECTIVE}`);
    const kane = spawn(k.cmd, k.args, { ...k.opts, stdio: ["ignore", "pipe", "inherit"] });
    let buf = "", end = null, credits = 0;
    kane.stdout.on("data", d => {
      buf += d; let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let ev; try { ev = JSON.parse(line); } catch { console.log("[kane:raw]", line); continue; }
        if (typeof ev.credits_consumed === "number") credits += ev.credits_consumed;
        if (ev.type === "run_end") end = ev;
        else if (ev.step !== undefined) console.log(`[kane] step ${ev.step} ${ev.status}: ${ev.remark || ""}`);
        else if (ev.type) console.log(`[kane] ${ev.type}`);
      }
    });
    kane.on("error", reject);
    kane.on("close", code => resolve({
      exit_code: code, // 0 passed, 1 failed, 2 error, 3 timeout
      status: end?.status, reason: end?.reason, one_liner: end?.one_liner,
      final_state: end?.final_state, test_url: end?.test_url,
      credits_from_events: Math.round(credits * 100) / 100, // check `kane-cli balance` before/after for the true cost
    }));
  });
}

// On Windows, `kane-cli` is a .cmd shim, and launching it through the shell splits the objective
// into separate words. So we find kane-cli's real entry file and run it with Node directly: no shell,
// every argument arrives intact (including spaces, quotes and ₦).
function kaneCommand(args) {
  if (process.platform !== "win32") return { cmd: "kane-cli", args, opts: {}, how: "kane-cli (no shell)" };
  try {
    const root = execSync("npm root -g", { encoding: "utf8" }).trim();
    const pkgDir = path.join(root, "@testmuai", "kane-cli");
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.["kane-cli"] ?? Object.values(pkg.bin || {})[0];
    const entry = path.join(pkgDir, bin);
    if (/\.exe$/i.test(entry)) return { cmd: entry, args, opts: {}, how: `${entry} (no shell)` };
    return { cmd: process.execPath, args: [entry, ...args], opts: {}, how: `node ${entry} (no shell)` };
  } catch (e) {
    // Last resort: shell, but with every argument quoted for cmd.exe.
    const q = a => (/[\s"&|<>^()%!]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
    return { cmd: ["kane-cli", ...args.map(q)].join(" "), args: [], opts: { shell: true }, how: `cmd.exe with quoted args (fallback: ${e.message})` };
  }
}

// Same flow, scripted, so the harness can be tested without spending Kane credits.
async function scriptedUser(browser) {
  const page = await browser.newPage();
  await sleep(500); // let the phone emulation attach
  await page.goto(URL);
  const screen = await page.$eval("#env", e => e.textContent);
  await page.click("#send");
  await page.waitForFunction(() => !/Sending|Checking/.test(document.getElementById("msg").textContent), { timeout: 30000 });
  let msg = await page.$eval("#msg", e => e.textContent);
  if (/failed/i.test(msg)) {
    await page.click("#send");
    await page.waitForFunction(() => !/Sending|Checking/.test(document.getElementById("msg").textContent), { timeout: 30000 });
    msg = await page.$eval("#msg", e => e.textContent);
  }
  await page.goto(`${URL}/history`);
  const count = Number(await page.$eval("#count", e => e.textContent));
  return { verifier: "scripted user (dry run)", screen, last_message: msg, transfer_count: count, status: count === 1 ? "passed" : "failed" };
}

main().catch(e => { console.error(e); process.exit(1); });
