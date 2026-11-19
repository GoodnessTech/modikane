// Network conditions: a local proxy between the phone and the app.
// It can add latency and drop the response to the first data-changing request
// AFTER the app has processed it, which is the case agents never test.
import http from "node:http";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function startProxy({ listenPort, targetPort, latencyMs = 0, drop = false, dropMatch = null, ignore = [], onEvent = () => {} }) {
  let dropped = null;
  const sleep = ms => (ms ? new Promise(r => setTimeout(r, ms)) : Promise.resolve());
  const matches = sig => {
    if (ignore.some(p => sig.includes(p))) return false;
    if (dropMatch) return new RegExp(dropMatch).test(sig);
    return MUTATING.has(sig.split(" ")[0]);
  };
  const server = http.createServer(async (req, res) => {
    const sig = `${req.method} ${req.url.split("?")[0]}`;
    if (MUTATING.has(req.method)) onEvent({ type: "write", sig });
    await sleep(latencyMs);
    const shouldDrop = drop && !dropped && matches(sig);
    const headers = { ...req.headers, host: `127.0.0.1:${targetPort}` };
    const up = http.request({ host: "127.0.0.1", port: targetPort, method: req.method, path: req.url, headers }, upRes => {
      if (shouldDrop) {
        dropped = sig;
        upRes.resume(); // let the app finish its work...
        upRes.on("end", () => { onEvent({ type: "dropped", sig, status: upRes.statusCode }); req.socket.destroy(); }); // ...then lose the reply
        return;
      }
      upRes.pause();
      sleep(latencyMs).then(() => { res.writeHead(upRes.statusCode, upRes.headers); upRes.pipe(res); });
    });
    up.on("error", e => { if (!res.headersSent) { res.writeHead(502); res.end(String(e)); } });
    req.pipe(up);
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(listenPort, "127.0.0.1", () => resolve({
      port: server.address().port,
      get dropped() { return dropped; },
      close: () => new Promise(r => { server.closeAllConnections?.(); server.close(() => r()); }),
    }));
  });
}
