# Real-time collaborative editor — project plan

## Decisions locked in so far
- **Conflict resolution: CRDT** (not OT), specifically a *sequence CRDT* for text
- **Backend:** Node.js + TypeScript
- **Frontend:** React
- **Philosophy:** implement the CRDT yourself — no Yjs/Automerge. Libraries are fine later for anything that *isn't* the core learning goal (e.g. UI components), but the conflict-resolution engine is hand-built.

## Why RGA first, Fugue later (the algorithm choice)

Sequence CRDTs give every character a stable, unique ID instead of a raw array position — that's the fix for the divergence bug from the very first diagram. There are several algorithms in this family; the two worth knowing:

- **RGA (Replicated Growable Array)** — the classical, well-documented one. Every character gets an ID (site ID + logical clock) and a reference to "the character I was inserted after." Concurrent inserts at the same position are ordered deterministically by comparing IDs. It has one known wart: if two users concurrently type multi-character insertions at the *same* spot (e.g. both start typing at the start of a line at the same moment), the two insertions can end up **interleaved** character-by-character in the final document, which looks broken even though it "converged."
- **Fugue** — a more recent algorithm (2023) that fixes exactly that interleaving anomaly, while keeping the same core "ID instead of position" idea. It's more impressive to cite in an interview, but it's easier to *get* once RGA's core idea is second nature.

**Plan: build RGA first.** It's the cleanest way to learn the core mechanism (unique IDs, causal ordering, tombstones) without extra complexity. Once RGA works end-to-end, upgrading the insertion-ordering rule to Fugue's approach is a contained, well-scoped follow-up — and gives you a genuinely interesting "here's a known limitation I identified and fixed" story for interviews.

## Architecture overview

```
┌─────────────────────────────┐        ┌─────────────────────────────┐
│   Client (React)            │        │   Client (React)            │
│   - local RGA replica        │        │   - local RGA replica        │
│   - renders doc from RGA     │        │   - renders doc from RGA     │
│   - presence/cursor state    │        │   - presence/cursor state    │
└──────────────┬───────────────┘        └──────────────┬───────────────┘
               │ WebSocket (ops + presence)             │
               ▼                                        ▼
        ┌─────────────────────────────────────────────────────┐
        │   Server (Node.js)                                   │
        │   - relays ops between connected clients             │
        │   - maintains authoritative op log per document      │
        │   - persistence layer (snapshots + op log)           │
        │   - tracks presence per connected client              │
        └─────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │   Database         │
                    │   (Postgres/SQLite)│
                    └───────────────────┘
```

Important nuance to internalize now: **the server does not run conflict resolution logic.** With a CRDT, correctness lives entirely in the data structure and merge rules, which every client *and* the server run identically. The server's job is relay + persistence + ordering-for-storage, not arbitration. That's the structural difference from OT you already learned.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Backend runtime | Node.js + TypeScript | matches your existing comfort |
| Real-time transport | Raw `ws` library, not Socket.IO | Socket.IO auto-handles reconnection/rooms for you — which hides exactly the mechanics you want to learn and defend. Raw WebSockets force you to build reconnection logic yourself. |
| Frontend | React + Vite | you've done tutorials, Vite keeps setup low-friction |
| Shared CRDT logic | Standalone TypeScript package, imported by both client and server | the CRDT algorithm must be identical on both sides — sharing one implementation prevents drift bugs |
| Persistence | SQLite to start (zero-config), swappable to Postgres later | avoids infra overhead early; schema will be designed to port cleanly |
| Editor UI | Plain `contenteditable` or a minimal text area at first, not a rich-text framework like ProseMirror | rich-text editors bring their own complexity that competes with the CRDT learning goal — keep the UI dumb, keep the CRDT smart |

## Build order (milestones)

**M0 — Local CRDT core, no network at all**
Implement the RGA data structure itself: unique IDs, insert-after semantics, tombstones for deletes, and a function that renders the current visible document from the structure. Test it by simulating concurrent operations *in code*, no UI, no network — prove convergence with unit tests before anything touches a browser.

**M1 — Real-time sync over WebSockets**
Stand up the WebSocket server. Each client's local edits become ops, broadcast to the server, relayed to other clients, applied to their local RGA replicas. This is where you get the "type a character, see it appear elsewhere instantly" feature you asked about. Test with two browser tabs typing concurrently in the same spot — this is the demo that proves the CRDT is actually doing its job.

**M2 — Persistence**
Server stores the op log (and periodic snapshots, so new clients don't have to replay the entire history from scratch) in the database. A client joining fresh loads the latest snapshot + any newer ops.

**M3 — Presence & cursor tracking**
A separate, lightweight channel (not CRDT ops — this is ephemeral, not authoritative document state) broadcasting "user X's cursor is at position Y," with colors/names per user, and cleanup when someone disconnects.

**M4 — Reconnection & offline editing**
The one that needs real design: a client that loses connection keeps queuing local ops against its local replica (this already works, for free, because of the CRDT). The interesting part is the *reconnection protocol* — how the client tells the server "here's what I already know" so the server sends only what's missing, rather than replaying everything. This is typically done with a version vector (a compact "which ops have I seen from each other client" summary).

**M5 — Stretch goals**
Upgrade RGA → Fugue to fix the interleaving anomaly; undo/redo; tombstone garbage collection (deleted characters accumulate forever unless you periodically compact them — a real production concern worth knowing about even if you don't fully implement it).

**M6 — Rich content (after the UI polish pass)**
- **Images:** extend the node type so a single node can represent one atomic embedded object instead of one character. Same sequence, same insert/delete/tombstone logic — just a different render for that node type.
- **Rich-text formatting (bold/italic/headings):** a documented extension of sequence CRDTs — formatting spans attached to ranges of the existing character sequence, rather than baked into individual characters. Worth knowing this by name in an interview: the "Peritext" approach (Ink & Switch) is the standard reference.
- **Tables: explicitly out of scope.** A table is inherently 2D/nested (rows of cells, each cell its own text run), which doesn't fit a flat sequence CRDT — real editors use a tree CRDT (Yjs's `XmlFragment`, Automerge's nested JSON model) for this, which is a comparably sized project on its own. Documented here as a known extension point with the correct approach named, rather than attempted under time pressure.

## Scope decision log
- Chose CRDT over OT (see top of doc)
- Chose to build RGA first, Fugue as a later upgrade
- Chose images + rich-text formatting as real features; explicitly scoped tables out in favor of depth over breadth

## M7 — Deployment + README (deliberately last)
Only after M2-M6 are functionally done:
- Deploy somewhere real (client as a static site, server wherever WebSockets are supported) so an interviewer can open a live URL and type into it in 10 seconds, rather than needing to clone and run it locally.
- Swap the ad hoc `node:assert` test scripts for a real test runner (e.g. vitest) — same tests, more credible presentation.
- Write the README: the CRDT-vs-OT decision and why, the architecture, and pointers to the specific bugs found/fixed along the way (nested-chain scanning bug, cursor-anchoring interleaving bug, late-join snapshot bug, controlled-input cursor reset) — this is effectively a pre-written answer to "walk me through this project" in an interview.

## Immediate next step
Before any code: understand the RGA data structure itself — the unique ID scheme, "insert after" semantics, and why tombstones (not real deletion) are necessary. That's the actual "aha" moment of this whole project.
