// Starts the user's app fresh for each run and stops it (with all its child processes) afterwards.
import { spawn, execSync } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { waitForPort } from "./phone.mjs";

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer(); s.unref(); s.on("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

const get = (port, path) => new Promise(r => {
  const req = http.get({ host: "127.0.0.1", port, path, timeout: 3000 }, res => { res.resume(); r(res.statusCode); });
  req.on("error", () => r(null)); req.on("timeout", () => { req.destroy(); r(null); });
});

export async function startApp(app, cwd, log = () => {}) {
  let child = null, output = "";
  if (app.start && (await get(app.port, app.ready)) !== null)
    throw new Error(`Something is already running on port ${app.port}. Stop it so Modikane can start a fresh copy, or remove app.start from modikane.yml to test the running app.`);
  if (app.start) {
    child = spawn(app.start, { cwd, shell: true, detached: process.platform !== "win32",
      env: { ...process.env, PORT: String(app.port), ...app.env }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", d => (output += d)); child.stderr.on("data", d => (output += d));
  }
  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    try {
      if (process.platform === "win32") execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
      else process.kill(-child.pid, "SIGTERM");
    } catch {}
    // wait until the port is free so the next run starts clean
    const end = Date.now() + 8000;
    while (Date.now() < end && (await get(app.port, app.ready)) !== null) await new Promise(r => setTimeout(r, 200));
  };
  if (!(await waitForPort(app.port, 60000))) {
    await stop();
    throw new Error(`App never opened port ${app.port}.${output ? " Its output:\n" + output.slice(-800) : ""}`);
  }
  const end = Date.now() + 30000;
  let status = null;
  while (Date.now() < end && !(status && status < 500)) { status = await get(app.port, app.ready); if (!status) await new Promise(r => setTimeout(r, 300)); }
  if (!status || status >= 500) { await stop(); throw new Error(`App answered ${app.ready} with ${status ?? "nothing"}.`); }
  log(`app ready on :${app.port}`);
  return { stop, started: !!child };
}
