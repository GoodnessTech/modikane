#!/usr/bin/env node
// Modikane: make Kane CLI verify your app the way Lagos uses it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, TEMPLATE, CONFIG_FILE, UserError } from "../src/config.mjs";
import { check, exitCodeFor } from "../src/check.mjs";
import { writeReports, summarise } from "../src/report.mjs";
import { doctor } from "../src/doctor.mjs";
import { CONDITIONS } from "../src/conditions.mjs";

const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"));
const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith("-") ? argv[0] : "help";
const flag = name => argv.includes(`--${name}`);
const opt = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const quiet = flag("json");
const log = m => { if (!quiet) console.error(m); };

const HELP = `modikane ${pkg.version}: verify your app the way Lagos uses it, with Kane CLI.

Usage:
  modikane init                   create ${CONFIG_FILE} and ignore .modikane/
  modikane doctor                 free check: app starts, phone + network conditions apply, Kane installed
  modikane check                  run every flow under every condition with Kane (uses Kane credits)
      --flow <name>               only this flow
      --condition <name>          only this condition (${Object.keys(CONDITIONS).join(", ")})
      --headless                  don't show the phone window
      --json                      print the results as JSON on stdout
  modikane conditions             list the Lagos conditions

Exit codes (check): 0 everything held up · 1 Kane caught a failure · 2 inconclusive`;

async function main() {
  if (cmd === "help" || flag("help")) return console.log(HELP), 0;
  if (cmd === "--version" || flag("version")) return console.log(pkg.version), 0;

  if (cmd === "conditions") {
    for (const [k, c] of Object.entries(CONDITIONS)) console.log(`${k.padEnd(18)} ${c.explain}`);
    return 0;
  }

  if (cmd === "init") {
    const p = path.resolve(CONFIG_FILE);
    if (fs.existsSync(p)) log(`${CONFIG_FILE} already exists, leaving it alone.`);
    else { fs.writeFileSync(p, TEMPLATE); log(`created ${CONFIG_FILE}: edit app.start, app.port and your flows.`); }
    const gi = path.resolve(".gitignore");
    const cur = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
    if (!/^\.modikane\/?$/m.test(cur)) { fs.writeFileSync(gi, cur + (cur && !cur.endsWith("\n") ? "\n" : "") + ".modikane/\n"); log("added .modikane/ to .gitignore"); }
    log("next: `modikane doctor` (free), then `modikane check`.");
    return 0;
  }

  if (cmd === "doctor") {
    const cfg = loadConfig(process.cwd(), opt("config") || CONFIG_FILE);
    return (await doctor({ cfg, headless: flag("headless"), log })) ? 0 : 2;
  }

  if (cmd === "check") {
    const cfg = loadConfig(process.cwd(), opt("config") || CONFIG_FILE);
    const results = await check({ cfg, onlyFlow: opt("flow"), onlyCondition: opt("condition"), headless: flag("headless"), log });
    const exitCode = exitCodeFor(results);
    const { dir, brief } = writeReports(cfg.dir, results, { version: pkg.version, exitCode });
    if (quiet) console.log(JSON.stringify({ exit_code: exitCode, results }, null, 2));
    else {
      log("\n──────────────── Modikane ────────────────");
      for (const r of results) log(`${r.status === "passed" ? "✓" : r.status === "failed" ? "✗" : "!"} ${r.flow} × ${r.condition_title}: ${summarise(r)}`);
      const credits = results.reduce((a, r) => a + (r.credits_reported || 0), 0);
      log(`\nReport: ${path.join(dir, "report.md")}`);
      log(`Kane reported ~${Math.round(credits)} credits (check \`kane-cli balance\` for the exact cost).`);
      if (brief) log("\n" + brief);
      log(exitCode === 0 ? "\nAll flows held up under Lagos conditions." : exitCode === 1 ? "\nKane caught a failure under Lagos conditions." : "\nInconclusive: see the errors above.");
    }
    return exitCode;
  }

  console.error(`Unknown command "${cmd}".\n\n${HELP}`);
  return 2;
}

main().then(code => process.exit(code), e => {
  console.error(e instanceof UserError ? `modikane: ${e.message}` : e.stack || e);
  process.exit(2);
});
