// Runs Kane CLI in --agent mode against our phone Chrome and returns its verdict.
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// On Windows, `kane-cli` is a .cmd shim and the shell splits the objective into words.
// So we find kane-cli's real entry file and run it with Node directly: no shell.
// MODIKANE_KANE overrides the command (used by the test suite's stand-in Kane).
export function kaneCommand(args) {
  if (process.env.MODIKANE_KANE) {
    const v = process.env.MODIKANE_KANE.trim();
    const [cmd, ...pre] = v.startsWith("[") ? JSON.parse(v) : v.split(" ");
    return { cmd, args: [...pre, ...args], how: process.env.MODIKANE_KANE };
  }
  if (process.platform !== "win32") return { cmd: "kane-cli", args, how: "kane-cli" };
  try {
    const root = execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const pkgDir = path.join(root, "@testmuai", "kane-cli");
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.["kane-cli"] ?? Object.values(pkg.bin || {})[0];
    const entry = path.join(pkgDir, bin);
    if (/\.exe$/i.test(entry)) return { cmd: entry, args, how: entry };
    return { cmd: process.execPath, args: [entry, ...args], how: `node ${entry}` };
  } catch (e) {
    const q = a => (/[\s"&|<>^()%!]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
    return { cmd: ["kane-cli", ...args.map(q)].join(" "), args: [], shell: true, how: "cmd.exe (fallback)" };
  }
}

export function runKane({ objective, cdpEndpoint, timeoutSec = 300, maxSteps = 40, onStep = () => {} }) {
  const args = ["run", objective, "--agent", "--cdp-endpoint", cdpEndpoint, "--mode", "testing",
    "--timeout", String(timeoutSec), "--max-steps", String(maxSteps)];
  const k = kaneCommand(args);
  return new Promise(resolve => {
    let child;
    try { child = spawn(k.cmd, k.args, { shell: !!k.shell, stdio: ["ignore", "pipe", "pipe"] }); }
    catch (e) { return resolve({ exit: 2, status: "error", reason: `could not start kane-cli: ${e.message}` }); }
    let out = "", err = "", end = null, credits = 0, evidence = null;
    const steps = [];
    child.stdout.on("data", d => {
      out += d; let i;
      while ((i = out.indexOf("\n")) >= 0) {
        const line = out.slice(0, i).trim(); out = out.slice(i + 1);
        if (!line) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (typeof ev.credits_consumed === "number") credits += ev.credits_consumed;
        if (ev.type === "run_end") end = ev;
        else if (ev.step !== undefined && ev.status && ev.status !== "running") {
          steps.push({ step: ev.step, status: ev.status, remark: ev.remark || "" });
          onStep(ev);
        }
      }
    });
    child.stderr.on("data", d => {
      err += d;
      const m = String(err).match(/kane-cli evidence serve (\S+?\.evidence)/);
      if (m) evidence = m[1].replace(/[`'"]/g, "");
    });
    child.on("error", e => resolve({ exit: 2, status: "error", reason: `could not start kane-cli: ${e.message}` }));
    child.on("close", code => resolve({
      exit: code ?? 2,
      status: end?.status || (code === 0 ? "passed" : code === 1 ? "failed" : "error"),
      reason: end?.reason || (end ? "" : lastLines(err)),
      one_liner: end?.one_liner || "",
      final_state: end?.final_state || {},
      test_url: end?.test_url || null,
      evidence, steps,
      credits_reported: Math.round(credits * 100) / 100,
    }));
  });
}

const lastLines = s => String(s).trim().split(/\r?\n/).slice(-3).join(" | ").slice(0, 400);
