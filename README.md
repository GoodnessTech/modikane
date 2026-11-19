# Modikane

Your coding agent tests on fast Wi-Fi. Your users are on 3G.

Modikane makes Kane CLI verify your app the way Lagos uses it: a 412px Android phone, slow 3G, and connections that drop after the server already moved the money. Failures feed back to your coding agent until the flow holds up.

**Status:** day-1 spike done, CLI in progress. Built for the Kane CLI Online Hackathon by TestMu AI.

## Day-1 spike

The spike checks whether Kane CLI can catch a double debit on an emulated Android phone when the network drops in the middle of a transfer.

- [spike/README.md](spike/README.md): what the spike is and how to run it
- [spike/RESULTS.md](spike/RESULTS.md): what happened when we ran it
