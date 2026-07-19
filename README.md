# Inkwell — a hand-built real-time collaborative editor

A Google-Docs-style collaborative text editor built to demonstrate real
distributed-systems and conflict-resolution engineering — not a wrapper
around an existing CRDT library (Yjs, Automerge). The conflict-resolution
algorithm, the real-time sync protocol, presence, persistence, and
reconnection logic are all implemented from scratch.

**[Live demo](#) — replace with your deployed URL once M7 is complete**

## Why CRDT, and why build it by hand

Real-time collaborative editing has two well-known solution families:
**Operational Transformation (OT)**, the classical approach (Google Docs'
original engine), and **CRDTs (Conflict-free Replicated Data Types)**, the
newer approach used by Figma, Linear, and Notion-style multiplayer engines.

I chose CRDT over OT for three reasons:

1. **Offline editing was an explicit requirement**, and it's what CRDTs are
   built for natively — a client just keeps applying local edits to its own
   replica and merges cleanly on reconnect, no special-cased backlog
   transformation required.
2. **The correctness argument is smaller and more self-contained.** OT's
   correctness proof depends on transform functions satisfying formal
   properties (TP1/TP2) across every operation-pair combination, composed
   over long operation sequences — a large surface area for subtle bugs.
   A CRDT's correctness follows from its merge function being commutative,
   associative, and idempotent — a property you can actually hold in your
   head and verify with a handful of targeted tests.
3. **No central arbiter required.** OT needs a server to establish a
   canonical operation order for correctness. A CRDT's server is just
   another replica — useful for relay and persistence, but not required for
   correctness.

Specifically, this project implements a **sequence CRDT** in the RGA
(Replicated Growable Array) family, later extended with ideas from the
[Fugue](https://arxiv.org/abs/2305.00583) paper (Kleppmann et al.) to fix a
real, reproduced interleaving anomaly — see below.

## Architecture

```
┌─────────────────────┐        ┌─────────────────────┐
│   Client (React)     │        │   Client (React)     │
│   local RGA replica   │        │   local RGA replica   │
└──────────┬───────────┘        └──────────┬───────────┘
           │ WebSocket (ops + presence)     │
           ▼                                ▼
    ┌───────────────────────────────────────────────┐
    │   Server (Node.js)                              │
    │   - relays ops between connected clients          │
    │   - maintains authoritative op log per document    │
    │   - snapshot + persistence (SQLite)                 │
    │   - presence tracking (ephemeral, in-memory only)      │
    │   - room-level password auth                            │
    └───────────────────────────────────────────────┘
                          │
                          ▼
                  SQLite (op log + snapshots)
```

**The server never runs conflict-resolution logic.** With a CRDT,
correctness lives entirely in the data structure and merge rules, run
identically by every client *and* the server. The server's job is relay,
persistence, and connection/room management — not arbitration.

### Package layout

- `packages/shared/` — the CRDT core (`rga.ts`), framework-agnostic,
  imported by both client and server
- `packages/server/` — WebSocket relay, SQLite persistence, presence,
  room password auth
- `packages/client/` — React UI, `contenteditable`-based editor,
  presence cursor overlay, rich-text rendering

## What's actually implemented

- **Sequence CRDT (RGA)** with unique per-character IDs, tombstone deletes,
  and a tie-break rule for concurrent inserts at the same position
- **Fugue extension**: left/right-sided origins, fixing a real, reproduced
  interleaving bug (see below) — backward-compatible with the base format
- **Real-time sync** over raw WebSockets (not Socket.IO, deliberately — to
  build and understand reconnection logic directly rather than have a
  library abstract it away)
- **Persistence**: append-only op log + periodic snapshot compaction in
  SQLite (`node:sqlite`, zero extra native dependencies)
- **Presence**: live cursor positions and names, rendered as an overlay
  layer separate from the editable content, with automatic clustering when
  multiple cursors land on the same spot
- **Offline editing + reconnection**: edits made while disconnected are
  queued locally and replayed on top of a fresh server snapshot on
  reconnect, using the CRDT's own merge guarantee rather than special-cased
  reconnect logic
- **Rich text**: bold/italic via Peritext-style formatting marks, resolved
  with last-writer-wins conflict resolution, independent of the character
  sequence itself
- **Images**: embedded as atomic placeholder nodes in the sequence,
  rendered as a positioned overlay (same mechanism as presence cursors)
- **Room-level password authentication**: first joiner sets a room's
  password (scrypt-hashed, constant-time compared); anyone with the
  password can delete the room, wiping its data and password together

## Deliberately out of scope

- **Tables** — fundamentally a 2D/nested structure that doesn't fit a flat
  sequence CRDT; a real implementation needs a tree CRDT (Yjs's
  `XmlFragment`, Automerge's nested JSON model), which is a comparably
  sized project on its own
- **Font family / other formatting values** — would reuse the exact same
  mark mechanism as bold/italic, just generalized from boolean to
  value-carrying; skipped because it doesn't add new algorithmic depth
- **Full user accounts** — room passwords are lightweight, deliberate
  scope; real accounts/sessions/permissions would be a large, well-understood
  addition that doesn't teach anything new about the CRDT/systems core

## Real bugs found and fixed along the way

This project's more interesting artifact than "it works" is the trail of
bugs found and fixed, each with a reproducing test:

1. **Nested-chain scanning bug (RGA core)** — the integrate algorithm
   initially stopped scanning as soon as it hit a node with a different
   direct origin, instead of correctly skipping past an entire nested
   subtree. Caused genuine divergence (not just interleaving) between
   replicas applying the same ops in different orders.
2. **Cursor-anchored-by-index bug (client)** — an early client
   implementation computed each new character's origin from the document's
   *current length* rather than the specific character it was typed after.
   Under real network latency, this caused two users' concurrent typing to
   splice into each other mid-word. Fixed by anchoring every keystroke to
   a specific character ID, tracked locally.
3. **Late-join snapshot bug** — a client joining a document with existing
   content was originally sent only the flattened string, not the real
   CRDT structure, leaving it with no valid IDs to anchor its own future
   edits to. Reproduced with a targeted late-join test before fixing.
4. **Fugue L-side subtree-boundary bug** — an early version of the
   left-child insertion algorithm conflated "skip past one descendant
   node" with "skip past this sibling's entire subtree," landing new
   nodes inside an existing subtree instead of after it. Caught by a
   three-way convergence test with a genuinely different operation
   ordering.
5. **Snapshot compaction dropping marks** — the persistence snapshot
   originally only captured the character sequence, not formatting marks;
   a mark applied before a snapshot point would be silently lost after a
   restart. Fixed by extending the snapshot schema.

One further honest note: **an unconfirmed race condition** was observed
once, early on, during concurrent client connection — never reliably
reproduced (5/5 clean across two separate machines), root cause never
confirmed. Documented rather than either falsely claimed fixed or silently
dropped.

## Running locally

```bash
npm install

# terminal 1
npx tsx packages/server/src/server.ts

# terminal 2
cd packages/client && npm run dev
```

Open the printed localhost URL, enter a room id and password (first use
creates the room), and start typing. Open multiple tabs with the same
room/password to see live sync.

## Running the tests

```bash
npm test
```

11 tests across 5 files, covering: basic convergence, delete/insert races,
the Fugue interleaving fix (including genuine commutativity under a
different operation ordering), image nodes, and rich-text mark conflict
resolution.

## Deploying

The server holds long-lived in-memory state and writes to a local SQLite
file — it needs a platform that runs a persistent process, not
serverless/edge functions. See `packages/client/.env.example` for the
required `VITE_WS_URL` production config.

**Known limitation**: on a free-tier host with ephemeral disk, the SQLite
file won't survive a redeploy or scale-to-zero event. This is a
hosting-tier limitation, not a code limitation — the persistence logic
itself is proven (see the hard-kill-and-restart tests during development).
