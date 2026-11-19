# Day-1 spike results

Kane CLI ran the NairaPay transfer flow on an emulated 412px Android phone, behind a proxy that drops the transfer response after the server has already moved the money. Run 1 was the free dry check (`node spike.mjs --dry`) with a scripted user. It gave 2 transfers and PHONE OK, so the harness worked.

| Run | App | Kane status / exit | Phone check | Server truth | Credits |
|---|---|---|---|---|---|
| 2 | buggy | failed / 1 | both taps on 412px Android, PHONE OK | 2 transfers, ₦10,000 | 38.52 |
| 3 | fixed | passed / 0 | 1 tap on 412px Android, PHONE OK | 1 transfer, ₦15,000 | 33.41 |

Kane's one-liner on the buggy run:

> "A transfer was recorded even though the app said it failed, so retrying once sent the money twice."

Kane failed the buggy app because of the double debit and passed the fixed app. Every Send tap happened on a 412px Android screen.

## What we learned

- **Kane forces a 1920px desktop screen at the start of every run.** The watchdog in `conditions.mjs` restores 412px before any tap. Chrome lets the most recently attached DevTools connection control the screen size, so the watchdog re-applies the phone through a fresh connection.
- **Kane's step notes can be wrong while its final check is right.** Verdicts therefore use Kane's final check together with the app's own record of what happened on the server.
- **One run costs about 36 credits.**
- **`spike.mjs` always exits 0.** Kane's exit code is in the "Verifier said" output. The real CLI will pass Kane's exit code through.
