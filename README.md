# Modikane

**Your coding agent tests on fast Wi-Fi. Your users are on 3G.**

Modikane makes [Kane CLI](https://www.testmuai.com/kane-cli/) verify your app the way Lagos uses it: on a 412px Android phone, on slow 3G, and with connections that drop **after the server already moved the money**. When a flow breaks, Modikane hands your coding agent a failure brief with Kane's evidence and the usual fix, so it can repair the app and prove the fix.

Built for the Kane CLI Online Hackathon by TestMu AI.

## The bug it was built to catch

A user taps **Send ₦5,000**. The server debits them, but the reply is lost on a weak connection. The app says "Transfer failed. Please try again." The user taps again and is debited twice. Unit tests pass, and so do happy-path browser tests on a fast laptop. Only a real browser on a bad network catches it.

```
✓ send-money × Phone: Held up under Phone (transfer_count=1, balance=15000)
✓ send-money × Slow 3G: Held up under Slow 3G (transfer_count=1, balance=15000)
✗ send-money × Drop after commit: A transfer was recorded even though the app said it failed,
  so retrying once sent the money twice. (transfer_count=2, balance=10000)
```

## Quick start

You need Node 18+, Google Chrome, and Kane CLI (free credits are enough):

```bash
npm install -g @testmuai/kane-cli
kane-cli login
```

Try it on the example app (it has a planted double-debit bug):

```bash
git clone https://github.com/GoodnessTech/modikane.git
cd modikane && npm install
cd examples/nairapay
node ../../bin/modikane.mjs doctor   # free: checks phone + network conditions, no Kane credits
node ../../bin/modikane.mjs check    # Kane runs the flow under every condition (~36 credits per run)
```

Expected: phone ✓, slow 3G ✓, drop after commit ✗, exit code 1. Run it again with `FIXED=1` and all three pass with exit code 0.

On your own app:

```bash
npx modikane init      # writes modikane.yml: how to start your app, and your key flows in plain English
npx modikane doctor
npx modikane check
```

## The Lagos conditions

| Condition | What it does |
|---|---|
| `phone` | 412px Android screen, touch, 4× slower CPU. Always on. |
| `slow-3g` | Phone, plus about 800ms extra round trip on every request. |
| `drop-after-commit` | Phone and slow network, plus the first data-changing request (POST/PUT/PATCH/DELETE) is processed by your server, but its reply never reaches the phone. |

The conditions are applied from outside the app, through a network proxy and a Chrome window Modikane controls, so the app can't game them. Kane attaches to that Chrome with `--cdp-endpoint`.

Modikane also checks that the conditions really applied: it records the screen size at the moment of every data-changing request. If any request came from a non-phone screen, the run is marked inconclusive instead of passing.

## Output

- **Exit codes:** `0` everything held up, `1` Kane caught a failure, `2` inconclusive.
- **`.modikane/report.md`:** a table per flow and condition, links to Kane's reports, and a failure brief for your coding agent.
- **`.modikane/last-run.json`:** the same results, machine-readable.
- **`--json`:** prints results to stdout.

Flows marked `money: true` always say a human must review the fix before it ships.

## Testing Modikane itself

`npm test` runs the whole pipeline end to end against NairaPay with a stand-in for Kane, so it costs no credits.

## How it was proven

See [spike/RESULTS.md](spike/RESULTS.md) for the day-1 runs with the real Kane CLI on Windows. Kane failed the buggy app, passed the fixed one, and every tap happened on a 412px Android screen.

## License

MIT
