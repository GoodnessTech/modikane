// A stand-in for kane-cli used ONLY by Modikane's test suite, so the pipeline can be tested
// without spending Kane credits. It behaves like Kane where it matters for Modikane:
// attaches over --cdp-endpoint, forces a 1920px desktop screen, follows the NairaPay flow
// like a user (retrying once when told to), and prints NDJSON + a run_end event.
import puppeteer from "puppeteer-core";
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("kane-cli 0.0.0-standin"); process.exit(0); }
const objective = args[1];
const cdp = args[args.indexOf("--cdp-endpoint") + 1];
const emit = o => console.log(JSON.stringify(o));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const url = objective.match(/Open (\S+?)\.?\s/)[1];
const browser = await puppeteer.connect({ browserURL: cdp, defaultViewport: null });
const page = await browser.newPage();
const s = await page.createCDPSession();
await s.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
emit({ type: "stream_start" });
await page.goto(url); await sleep(700); emit({ step: 1, status: "done", remark: "navigate" });
const done = () => page.waitForFunction(() => !/Sending|Checking/.test(document.getElementById("msg").textContent), { timeout: 30000 });
await page.click("#send"); await done(); emit({ step: 2, status: "done", remark: "click Send money" });
if (/try the same action again/.test(objective) && /failed/i.test(await page.$eval("#msg", e => e.textContent))) {
  await page.click("#send"); await done(); emit({ step: 3, status: "done", remark: "retry like a user" });
}
await page.goto(url.replace(/\/$/, "") + "/history");
const count = Number(await page.$eval("#count", e => e.textContent));
const balance = Number((await page.$eval("b", e => e.textContent)).replace(/[^\d]/g, ""));
const passed = count === 1 && balance === 15000;
emit({ type: "run_end", status: passed ? "passed" : "failed", credits_consumed: 0,
  reason: passed ? "" : `Final verification failed: "there is exactly 1 transfer and the balance is 15,000 naira"`,
  one_liner: passed ? "" : `Stand-in saw ${count} transfers and a balance of ${balance}.`,
  final_state: { transfer_count: count, balance } });
console.error("evidence: view locally with `kane-cli evidence serve /tmp/standin.evidence`");
await browser.disconnect();
process.exit(passed ? 0 : 1);
