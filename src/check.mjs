// modikane check: run every flow under every Lagos condition, with Kane as the judge.
import { CONDITIONS, PHONE } from "./conditions.mjs";
import { startProxy } from "./proxy.mjs";
import { startPhone } from "./phone.mjs";
import { startApp, freePort } from "./app.mjs";
import { runKane } from "./kane.mjs";

export function buildObjective(url, flow, condition) {
  const c = CONDITIONS[condition];
  return [`Open ${url}.`, c.behaviour, flow.goal].filter(Boolean).join(" ");
}

export async function runOne({ cfg, flow, condition, headless, log }) {
  const c = CONDITIONS[condition];
  const started = Date.now();
  const writes = [];
  let app, proxy, phone;
  try {
    app = await startApp(cfg.app, cfg.dir, log);
    proxy = await startProxy({
      listenPort: await freePort(), targetPort: cfg.app.port, latencyMs: c.latencyMs, drop: c.drop,
      dropMatch: cfg.drop_match, ignore: cfg.ignore,
      onEvent: ev => {
        if (ev.type === "dropped") log(`network: dropped the reply to ${ev.sig} after the app processed it`);
        if (ev.type === "write" && !cfg.ignore.some(p => ev.sig.includes(p))) writes.push(phone ? phone.screens().then(s => ({ sig: ev.sig, screens: s })) : Promise.resolve({ sig: ev.sig, screens: [] }));
      },
    });
    phone = await startPhone({ port: await freePort(), headless });
    const url = `http://127.0.0.1:${proxy.port}${flow.path || "/"}`;
    const objective = buildObjective(url, flow, condition);
    log(`kane: running "${flow.name}" under ${c.title}`);
    const kane = await runKane({ objective, cdpEndpoint: phone.cdpEndpoint, onStep: ev => log(`kane step ${ev.step} ${ev.status}: ${ev.remark || ""}`.slice(0, 160)) });

    // Prove the conditions really applied: every data-changing request must come from a phone-sized screen.
    const seen = await Promise.all(writes);
    const phoneOk = seen.every(w => w.screens.length && w.screens.every(s => s.w === PHONE.width && s.android));
    const notes = [];
    if (!seen.length) notes.push("no data-changing request was made during this run");
    if (c.drop && !proxy.dropped) notes.push("the network-drop condition was not exercised (nothing to drop)");
    if (phone.restores) notes.push(`phone screen restored ${phone.restores}x after Kane tried to switch to desktop`);

    let status = kane.status;
    let reason = kane.reason;
    if (!phoneOk && status !== "error") { status = "error"; reason = "Conditions not applied: a request came from a non-phone screen, so this result can't be trusted."; }
    return {
      flow: flow.name, money: flow.money, condition, condition_title: c.title, status, exit: kane.exit,
      reason, one_liner: kane.one_liner, final_state: kane.final_state,
      test_url: kane.test_url, evidence: kane.evidence, steps: kane.steps,
      phone_ok: phoneOk, writes: seen.map(w => ({ sig: w.sig, screens: w.screens.map(s => `${s.w}px ${s.android ? "Android" : "Desktop"}`) })),
      dropped: proxy.dropped, notes, objective,
      credits_reported: kane.credits_reported, seconds: Math.round((Date.now() - started) / 1000),
    };
  } catch (e) {
    return { flow: flow.name, money: flow.money, condition, condition_title: c.title, status: "error", exit: 2,
      reason: e.message, notes: [], writes: [], steps: [], seconds: Math.round((Date.now() - started) / 1000) };
  } finally {
    await phone?.stop().catch(() => {});
    await proxy?.close().catch(() => {});
    await app?.stop().catch(() => {});
  }
}

export async function check({ cfg, onlyFlow, onlyCondition, headless, log }) {
  const flows = cfg.flows.filter(f => !onlyFlow || f.name === onlyFlow);
  const conditions = cfg.conditions.filter(c => !onlyCondition || c === onlyCondition);
  if (!flows.length) throw new Error(`No flow named "${onlyFlow}".`);
  if (!conditions.length) throw new Error(`Condition "${onlyCondition}" isn't enabled in modikane.yml.`);
  const results = [];
  for (const flow of flows) for (const condition of conditions) {
    log(`\n▶ ${flow.name} × ${CONDITIONS[condition].title}`);
    const r = await runOne({ cfg, flow, condition, headless, log: m => log("  " + m) });
    log(`  ${r.status === "passed" ? "✓ passed" : r.status === "failed" ? "✗ FAILED" : "! error"}${r.one_liner ? ": " + r.one_liner : r.reason ? ": " + r.reason : ""}`);
    results.push(r);
  }
  return results;
}

// 0 = everything passed, 1 = Kane caught at least one failure, 2 = inconclusive (errors, nothing failed)
export function exitCodeFor(results) {
  if (results.some(r => r.status === "failed")) return 1;
  if (results.some(r => r.status !== "passed")) return 2;
  return 0;
}
