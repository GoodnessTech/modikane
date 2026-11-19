// Loads modikane.yml.
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { CONDITIONS, DEFAULT_CONDITIONS } from "./conditions.mjs";

export const CONFIG_FILE = "modikane.yml";

export const TEMPLATE = `# Modikane: verify your app the way Lagos uses it.
# Docs: https://github.com/GoodnessTech/modikane

app:
  # Command that starts your app. Modikane starts it fresh before every run, so each
  # run begins from clean state. Leave it out if your app is already running.
  start: npm run dev
  # Port your app listens on.
  port: 3000
  # Wait for this path to answer before testing.
  ready: /

# Your key flows, in plain English. Each goal must END WITH A CHECK Kane can verify,
# ideally on a page that shows the real saved result (history, orders, account).
flows:
  - name: checkout
    money: true   # money flows always need a human sign-off before the agent's fix ships
    goal: >
      Add the first product to the cart and complete checkout.
      Then open the Orders page and check that there is exactly 1 order.

# Lagos conditions to run every flow under. Remove any you don't want.
conditions: [phone, slow-3g, drop-after-commit]

# Optional: requests the network-drop condition must never drop (analytics, beacons).
# ignore: ["/api/analytics"]
# Optional: drop exactly this request instead of the first data-changing one.
# drop_match: "^POST /api/orders$"
`;

export function loadConfig(dir = process.cwd(), file = CONFIG_FILE) {
  const p = path.resolve(dir, file);
  if (!fs.existsSync(p)) throw new UserError(`No ${file} here. Run \`modikane init\` first.`);
  let c;
  try { c = YAML.parse(fs.readFileSync(p, "utf8")) || {}; } catch (e) { throw new UserError(`${file} is not valid YAML: ${e.message}`); }
  const app = c.app || {};
  if (!app.port) throw new UserError(`${file}: app.port is required.`);
  const flows = Array.isArray(c.flows) ? c.flows : [];
  if (!flows.length) throw new UserError(`${file}: add at least one flow under "flows".`);
  flows.forEach((f, i) => {
    if (!f.name || !f.goal) throw new UserError(`${file}: flow #${i + 1} needs a name and a goal.`);
  });
  const conditions = c.conditions || DEFAULT_CONDITIONS;
  const bad = conditions.filter(x => !CONDITIONS[x]);
  if (bad.length) throw new UserError(`${file}: unknown condition(s) ${bad.join(", ")}. Use: ${Object.keys(CONDITIONS).join(", ")}`);
  return {
    dir: path.dirname(p),
    app: { start: app.start || null, port: Number(app.port), ready: app.ready || "/", env: app.env || {} },
    flows: flows.map(f => ({ name: String(f.name), goal: String(f.goal).trim(), money: !!f.money, path: f.path || "/" })),
    conditions, ignore: c.ignore || [], drop_match: c.drop_match || null,
  };
}

export class UserError extends Error {}
