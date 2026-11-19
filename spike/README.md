# Modikane: day-1 risk test

**Question this answers:** can Kane CLI verify a real flow on an emulated Android phone, while the network drops in the middle of a money transfer, on a Windows PC?

If yes, Modikane is a go. If no, we change the approach before writing any real code.

## What's inside

| File | What it does |
|---|---|
| `shop.mjs` | **NairaPay**, a tiny wallet app with a planted bug: if the connection drops after the server debits you, it says "Transfer failed", you tap Send again, and you're debited twice. `FIXED=1` turns on the fix (idempotency key + status check). |
| `conditions.mjs` | The Lagos conditions, applied from outside the app: a local proxy that adds latency and drops one response **after** the server has moved the money, plus a Chrome we launch ourselves that emulates a mid-range Android phone (412px, touch, Android UA, 4× slower CPU). |
| `spike.mjs` | Starts the app, the conditions and the phone Chrome, then has **Kane CLI attach with `--cdp-endpoint`** and run the flow in plain English. Prints Kane's verdict next to the server's truth. |

## Setup (Windows, once)

You need Node 18+ and Google Chrome.

```powershell
npm install -g @testmuai/kane-cli
kane-cli login          # use the same email you registered on testmuai.com
kane-cli balance        # confirm the 10,000 credits are there
cd modikane-spike
npm install
```

If Chrome isn't in the default place: `$env:CHROME_PATH="C:\path\to\chrome.exe"`

## Run it (in this order)

```powershell
# 1. Free check of the harness, no credits used. Expect: 2 transfers, "failed".
node spike.mjs --dry

# 2. The real test: Kane on the BUGGY app. Expect: Kane FAILS (exit code 1).
node spike.mjs

# 3. Kane on the FIXED app. Expect: Kane PASSES (exit code 0).
$env:FIXED=1; node spike.mjs; Remove-Item Env:FIXED
```

You'll see a phone-shaped Chrome window open. Watch Kane tap through it.

## How to read the result

Look at `final_state.screen` in Kane's output. It should say **`Screen: 412px wide · Android`**.

| What you see | Meaning | Next step |
|---|---|---|
| Run 2 fails because of the double debit, run 3 passes, screen says 412px Android | ✅ **Go.** Every risky part works. | Start building Modikane. |
| Kane works, but screen says ~1900px / Desktop | Kane overrode our phone emulation. Network conditions still work. | Send me the output. We'll try applying emulation differently or switch to a desktop-plus-network version. |
| Kane can't attach (`CDP endpoint not reachable`) | Chrome didn't open port 9222. | Close every Chrome window and rerun. If it still fails, send me the output. |
| Kane passes run 2 | It didn't retry like a user, or it misread the History page. | Send me the output. We'll tighten the objective wording. |

Each Kane run costs credits. Run 2 and run 3 once each, then stop and send me the output.
