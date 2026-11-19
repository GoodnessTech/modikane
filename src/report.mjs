// Writes .modikane/last-run.json (for tools and the Claude Code hook) and .modikane/report.md (for people).
import fs from "node:fs";
import path from "node:path";
import { CONDITIONS, FIX_HINTS } from "./conditions.mjs";

const icon = s => (s === "passed" ? "✅ passed" : s === "failed" ? "❌ FAILED" : "⚠️ error");

export function summarise(r) {
  if (r.status === "error") return r.reason || "Kane could not finish this run.";
  const fs = r.final_state && Object.keys(r.final_state).length
    ? Object.entries(r.final_state).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(", ") : "";
  const base = r.status === "failed" ? (r.one_liner || r.reason) : `Held up under ${r.condition_title}`;
  return [base, fs && `(${fs})`].filter(Boolean).join(" ");
}

// The brief handed to a coding agent when a run fails: what broke, where, why, and what usually fixes it.
export function failureBrief(results) {
  const fails = results.filter(r => r.status === "failed");
  if (!fails.length) return "";
  const lines = ["Modikane: your change does not hold up under real-world (Lagos) conditions.", ""];
  for (const r of fails) {
    lines.push(`FLOW "${r.flow}" FAILED under ${r.condition_title} (${CONDITIONS[r.condition].explain}).`);
    if (r.one_liner) lines.push(`Kane saw: ${r.one_liner}`);
    if (r.reason) lines.push(`Failed check: ${r.reason}`);
    if (r.dropped) lines.push(`Network: the reply to ${r.dropped} was lost AFTER the server processed it.`);
    if (r.final_state && Object.keys(r.final_state).length) lines.push(`Final state: ${JSON.stringify(r.final_state)}`);
    lines.push(`Usual fix: ${FIX_HINTS[r.condition]}`);
    if (r.evidence) lines.push(`Evidence: kane-cli evidence serve ${r.evidence}`);
    if (r.test_url) lines.push(`Report: ${r.test_url}`);
    if (r.money) lines.push(`This is a MONEY flow: fix it, but a human must review the change before it ships.`);
    lines.push("");
  }
  lines.push("Fix the app (not the test), then run `modikane check` again.");
  return lines.join("\n");
}

export function writeReports(dir, results, meta) {
  const out = path.join(dir, ".modikane");
  fs.mkdirSync(out, { recursive: true });
  const json = { tool: "modikane", version: meta.version, at: new Date().toISOString(), exit_code: meta.exitCode, results };
  fs.writeFileSync(path.join(out, "last-run.json"), JSON.stringify(json, null, 2));

  const md = [
    `# Modikane report`, ``,
    `${new Date().toUTCString()} · exit code **${meta.exitCode}** (${meta.exitCode === 0 ? "everything held up" : meta.exitCode === 1 ? "Kane caught a failure" : "inconclusive"})`, ``,
    `| Flow | Condition | Result | What happened | Phone | Evidence |`,
    `|---|---|---|---|---|---|`,
    ...results.map(r => `| ${r.flow}${r.money ? " 💰" : ""} | ${r.condition_title} | ${icon(r.status)} | ${summarise(r).replace(/\|/g, "/")} | ${r.phone_ok ? "412px Android ✓" : r.writes?.length ? "not guarded ✗" : "–"} | ${r.test_url ? `[Kane report](${r.test_url})` : "–"} |`),
    ``,
  ];
  const brief = failureBrief(results);
  if (brief) md.push("## Failure brief for your coding agent", "", "```", brief, "```", "");
  const notes = results.filter(r => r.notes?.length);
  if (notes.length) md.push("## Notes", "", ...notes.map(r => `- **${r.flow} × ${r.condition_title}:** ${r.notes.join("; ")}`), "");
  md.push("## Conditions", "", ...Object.entries(CONDITIONS).map(([k, c]) => `- **${c.title}** (\`${k}\`): ${c.explain}`), "");
  fs.writeFileSync(path.join(out, "report.md"), md.join("\n"));
  return { dir: out, brief };
}
