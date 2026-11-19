// The Lagos conditions. Each one is applied from OUTSIDE the app, so the app can't cheat:
//   phone              412px Android screen, touch, 4x slower CPU (always on)
//   slow-3g            extra latency on every request
//   drop-after-commit  the server processes the first data-changing request,
//                      but the response never reaches the phone ("debit alert, no credit")
export const CONDITIONS = {
  "phone": {
    title: "Phone",
    explain: "412px Android screen, touch, 4x slower CPU, normal network",
    latencyMs: 0, drop: false,
    behaviour: "",
  },
  "slow-3g": {
    title: "Slow 3G",
    explain: "phone + about 800ms extra round-trip on every request",
    latencyMs: 400, drop: false,
    behaviour: "The connection is slow. Wait patiently for each screen to finish loading before acting.",
  },
  "drop-after-commit": {
    title: "Drop after commit",
    explain: "phone + slow network, and the first data-changing request is processed by the server but its response is lost",
    latencyMs: 400, drop: true,
    behaviour: "If the app says something failed or shows an error, try the same action again once, like a real user would. Wait until the page shows a final message before moving on.",
  },
};

// What usually fixes each kind of failure. Fed to the coding agent with the evidence.
export const FIX_HINTS = {
  "phone": "Check layout at 412px: overflowing or hidden buttons, elements covered by banners or sticky bars, tap targets too small, inputs that need hover.",
  "slow-3g": "Check loading states: buttons that can be tapped twice while a request is in flight, spinners that never end, timeouts that are too short, content that jumps.",
  "drop-after-commit": "The server did the work but the client never heard back. Make the write idempotent (send an idempotency key the server dedupes on), and on a network error check the real status before telling the user it failed or letting them retry.",
};

export const DEFAULT_CONDITIONS = ["phone", "slow-3g", "drop-after-commit"];

export const PHONE = {
  width: 412, height: 915, deviceScaleFactor: 2.625, cpuSlowdown: 4,
  userAgent: "Mozilla/5.0 (Linux; Android 13; Infinix X6833B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
};
