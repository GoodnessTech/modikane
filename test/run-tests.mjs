// End-to-end test of Modikane with the stand-in Kane (no credits). Run: npm test
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ex = path.join(root, "examples", "nairapay");
const standin = JSON.stringify([process.execPath, path.join(root, "test", "stand-in-kane.mjs")]);
let failures = 0;
const run = (args, env = {}) => spawnSync(process.execPath, [path.join(root, "bin", "modikane.mjs"), ...args],
  { cwd: ex, env: { ...process.env, MODIKANE_KANE: standin, ...env }, encoding: "utf8", timeout: 300000 });
const expect = (name, cond, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${cond ? "" : "  " + detail}`); if (!cond) failures++; };

const d = run(["doctor", "--headless"]);
expect("doctor passes", d.status === 0, d.stderr);

const b = run(["check", "--headless", "--json"], { FIXED: "0" });
const bj = JSON.parse(b.stdout || "{}");
const by = c => bj.results?.find(r => r.condition === c) || {};
expect("buggy app: exit code 1", b.status === 1, b.stderr.slice(-800));
expect("buggy app: passes on phone", by("phone").status === "passed", JSON.stringify(by("phone")));
expect("buggy app: passes on slow 3G", by("slow-3g").status === "passed", JSON.stringify(by("slow-3g")));
expect("buggy app: FAILS when the reply is dropped", by("drop-after-commit").status === "failed", JSON.stringify(by("drop-after-commit")));
expect("buggy app: the dropped request was the transfer", by("drop-after-commit").dropped === "POST /api/transfer");
expect("buggy app: every write came from a 412px Android screen", bj.results?.every(r => r.phone_ok));
expect("report.md written", fs.existsSync(path.join(ex, ".modikane", "report.md")));
expect("failure brief names the fix", /idempotent/.test(fs.readFileSync(path.join(ex, ".modikane", "report.md"), "utf8")));

const f = run(["check", "--headless", "--json"], { FIXED: "1" });
const fj = JSON.parse(f.stdout || "{}");
expect("fixed app: exit code 0", f.status === 0, f.stderr.slice(-800));
expect("fixed app: all conditions pass", fj.results?.every(r => r.status === "passed"), JSON.stringify(fj.results?.map(r => [r.condition, r.status, r.reason])));
expect("fixed app: every write came from a 412px Android screen", fj.results?.every(r => r.phone_ok));

console.log(failures ? `\n${failures} test(s) failed` : "\nAll tests passed");
process.exit(failures ? 1 : 0);
