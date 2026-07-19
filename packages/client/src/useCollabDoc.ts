import { useEffect, useRef, useState, useCallback } from 'react';
import { RgaDocument } from '../../shared/src/index.js';
import type { RgaOp } from '../../shared/src/index.js';

function diff(oldStr: string, newStr: string) {
  let start = 0;
  const maxStart = Math.min(oldStr.length, newStr.length);
  while (start < maxStart && oldStr[start] === newStr[start]) start++;
  let oldEnd = oldStr.length;
  let newEnd = newStr.length;
  while (oldEnd > start && newEnd > start && oldStr[oldEnd - 1] === newStr[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return { start, deletedCount: oldEnd - start, inserted: newStr.slice(start, newEnd) };
}

function getCaretOffset(container: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  const preRange = range.cloneRange();
  preRange.selectNodeContents(container);
  preRange.setEnd(range.endContainer, range.endOffset);
  return preRange.toString().length;
}

function setCaretOffset(container: HTMLElement, offset: number) {
  const sel = window.getSelection();
  if (!sel) return;
  let remaining = offset;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    const len = node.textContent?.length ?? 0;
    if (remaining <= len) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    remaining -= len;
    node = walker.nextNode() as Text | null;
  }
  const range = document.createRange();
  range.selectNodeContents(container);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

// Given a character offset, find its actual pixel location on screen --
// needed to position presence markers, which live in a completely separate
// overlay layer, NOT injected into the contenteditable content itself.
function getOffsetPixelRect(container: HTMLElement, offset: number): DOMRect | null {
  let remaining = offset;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    const len = node.textContent?.length ?? 0;
    if (remaining <= len) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      const rects = range.getClientRects();
      return rects.length > 0 ? rects[0] : range.getBoundingClientRect();
    }
    remaining -= len;
    node = walker.nextNode() as Text | null;
  }
  const range = document.createRange();
  range.selectNodeContents(container);
  range.collapse(false);
  const rects = range.getClientRects();
  return rects.length > 0 ? rects[0] : range.getBoundingClientRect();
}

// Builds real DOM structure from formatted runs -- <b>/<i> elements wrap
// text nodes as needed. Image runs render as their plain placeholder
// character; the actual <img> is a separate overlay (see App.tsx),
// exactly like presence markers.
function renderRuns(container: HTMLElement, runs: Array<{ text: string; bold: boolean; italic: boolean; imageSrc?: string }>) {
  container.innerHTML = '';
  for (const run of runs) {
    let content: Node = document.createTextNode(run.text);
    if (run.imageSrc) {
      container.appendChild(content);
      continue;
    }
    if (run.italic) {
      const el = document.createElement('i');
      el.appendChild(content);
      content = el;
    }
    if (run.bold) {
      const el = document.createElement('b');
      el.appendChild(content);
      content = el;
    }
    container.appendChild(content);
  }
}

// Reads the current (possibly multi-character) selection as plain visible
// character indices -- needed for "bold this selected text", as opposed
// to getCaretOffset which only handles a single collapsed cursor position.
function getSelectionRange(container: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return null;
  const preRange = range.cloneRange();
  preRange.selectNodeContents(container);
  preRange.setEnd(range.startContainer, range.startOffset);
  const start = preRange.toString().length;
  const end = start + range.toString().length;
  return { start, end };
}

const COLOR_PALETTE = ['#457b9d', '#e63946', '#1d9e75', '#f4a261', '#9b5de5', '#2a9d8f'];
function colorForUserId(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return COLOR_PALETTE[hash % COLOR_PALETTE.length];
}

export interface PresenceInfo {
  userId: string;
  name: string;
  color: string;
  cursorPos: number;
}

export interface Marker {
  key: string;
  top: number;
  left: number;
  height: number;
  users: PresenceInfo[]; // length 1 = individual label; 2+ = cluster badge
}

export interface ImageOverlay {
  key: string;
  top: number;
  left: number;
  height: number;
  src: string;
}

export function useCollabDoc(docId: string, password: string) {
  const docRef = useRef<RgaDocument>(new RgaDocument(crypto.randomUUID()));
  const socketRef = useRef<WebSocket | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [connected, setConnected] = useState(false);
  const [authState, setAuthState] = useState<'pending' | 'accepted' | 'rejected' | 'deleted'>('pending');
  const [docVersion, setDocVersion] = useState(0); // bumped on any doc change, triggers marker recompute
  const [remoteUsers, setRemoteUsers] = useState<Map<string, PresenceInfo>>(new Map());
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [images, setImages] = useState<ImageOverlay[]>([]);

  // Ops created while disconnected can't just be sent -- they'd silently
  // vanish. Queue them locally; they get replayed on top of a fresh
  // snapshot and re-sent the moment the connection comes back.
  const pendingOpsRef = useRef<RgaOp[]>([]);

  const sendOrQueueOp = useCallback((op: RgaOp) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(op));
    } else {
      pendingOpsRef.current.push(op);
    }
  }, []);

  const myUserIdRef = useRef(crypto.randomUUID());
  const myColorRef = useRef(colorForUserId(myUserIdRef.current));
  const [myName, setMyNameState] = useState(`Guest-${myUserIdRef.current.slice(0, 4)}`);
  const myNameRef = useRef(myName);
  useEffect(() => {
    myNameRef.current = myName;
  }, [myName]);

  const presenceThrottleRef = useRef<number | null>(null);

  const sendPresenceNow = useCallback(() => {
    const container = containerRef.current;
    const socket = socketRef.current;
    if (!container || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: 'presence',
        userId: myUserIdRef.current,
        name: myNameRef.current,
        color: myColorRef.current,
        cursorPos: getCaretOffset(container),
      })
    );
  }, []);

  const sendPresence = useCallback(() => {
    if (presenceThrottleRef.current !== null) return;
    presenceThrottleRef.current = window.setTimeout(() => {
      presenceThrottleRef.current = null;
      sendPresenceNow();
    }, 120); // throttle -- don't flood the server on every keystroke/click
  }, [sendPresenceNow]);

  // A name change is a deliberate, infrequent action -- broadcast it
  // immediately rather than waiting on the throttle meant for cursor spam.
  const setMyName = useCallback(
    (name: string) => {
      setMyNameState(name);
      myNameRef.current = name;
      sendPresenceNow();
    },
    [sendPresenceNow]
  );

  useEffect(() => {
    let stopped = false;
    let rejected = false; // local, not React state -- avoids a stale-closure
                           // read of authState inside onclose below
    let reconnectAttempt = 0;
    let reconnectTimer: number | null = null;

    function connect() {
      // In production this needs to point at the real deployed server --
      // set VITE_WS_URL at build time. Falls back to localhost for local dev.
      const wsBase = import.meta.env.VITE_WS_URL || 'ws://localhost:8080';
      const socket = new WebSocket(`${wsBase}/${docId}`);
      socketRef.current = socket;

      socket.onopen = () => {
        reconnectAttempt = 0; // reset backoff once a connection actually succeeds
        setConnected(true);
        // Room access is gated -- send credentials FIRST, before anything
        // else. Presence isn't announced until the server confirms 'join-accepted'.
        socket.send(JSON.stringify({ type: 'join', password }));
      };

      socket.onclose = () => {
        setConnected(false);
        if (stopped || rejected) return;
        // Exponential backoff, capped at 10s, retried indefinitely --
        // a dropped wifi connection should quietly keep trying, not give up.
        const delay = Math.min(1000 * 2 ** reconnectAttempt, 10000);
        reconnectAttempt++;
        reconnectTimer = window.setTimeout(connect, delay);
      };

      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === 'join-accepted') {
          setAuthState('accepted');
          sendPresence();
          return;
        }

        if (msg.type === 'join-rejected') {
          rejected = true; // stops the reconnect loop above
          setAuthState('rejected'); // updates the UI
          return;
        }

        if (msg.type === 'room-deleted') {
          rejected = true; // room is gone -- reconnecting would be pointless
          setAuthState('deleted');
          return;
        }

        if (msg.type === 'init') {
          // This fires on every connection, first-time or reconnect --
          // the server can't tell the difference, and we don't need it to.
          docRef.current.loadSnapshot(msg.nodes);
          docRef.current.loadMarksSnapshot(msg.marks ?? []);

          // Replay whatever we queued while offline on TOP of this fresh
          // state. This is just applyRemote, same as any other op arriving
          // from elsewhere -- the CRDT's own convergence guarantee is what
          // makes this safe, not any special-case reconnect logic. On a
          // genuine first connect, the queue is empty and this is a no-op.
          const pending = pendingOpsRef.current;
          pendingOpsRef.current = [];
          for (const op of pending) {
            docRef.current.applyRemote(op);
          }

          if (containerRef.current) renderRuns(containerRef.current, docRef.current.getFormattedRuns());
          setDocVersion((v) => v + 1);

          // The server's fresh snapshot doesn't know about our offline
          // edits yet -- tell it now that we're actually connected.
          for (const op of pending) {
            sendOrQueueOp(op);
          }
          return;
        }

        if (msg.type === 'presence-init') {
          const m = new Map<string, PresenceInfo>();
          for (const u of msg.users) m.set(u.userId, u);
          setRemoteUsers(m);
          return;
        }
        if (msg.type === 'presence') {
          setRemoteUsers((prev) => {
            const next = new Map(prev);
            next.set(msg.userId, { userId: msg.userId, name: msg.name, color: msg.color, cursorPos: msg.cursorPos });
            return next;
          });
          return;
        }
        if (msg.type === 'presence-leave') {
          setRemoteUsers((prev) => {
            const next = new Map(prev);
            next.delete(msg.userId);
            return next;
          });
          return;
        }

        // Remote CRDT op (insert, delete, or mark -- all handled uniformly).
        const container = containerRef.current;
        const oldText = docRef.current.toString();
        docRef.current.applyRemote(msg as RgaOp);
        const newText = docRef.current.toString();

        if (container) {
          // For a pure formatting change, oldText === newText and this diff
          // is a no-op -- the cursor correctly stays put; only the visual
          // rendering below needs to happen.
          const { start, deletedCount, inserted } = diff(oldText, newText);
          const currentCursor = getCaretOffset(container);
          let adjustedCursor = currentCursor;
          if (currentCursor > start) {
            adjustedCursor = Math.max(start, currentCursor + (inserted.length - deletedCount));
          }
          renderRuns(container, docRef.current.getFormattedRuns());
          setCaretOffset(container, adjustedCursor);
        }
        setDocVersion((v) => v + 1);
      };
    }

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, [docId, password, sendPresence, sendOrQueueOp]);

  // Recompute marker screen positions whenever presence changes OR the
  // document's text/layout changes (word wrap shifts every position below it).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const groups = new Map<number, PresenceInfo[]>();
    for (const info of remoteUsers.values()) {
      const arr = groups.get(info.cursorPos) ?? [];
      arr.push(info);
      groups.set(info.cursorPos, arr);
    }

    const containerRect = container.getBoundingClientRect();
    const next: Marker[] = [];
    for (const [pos, users] of groups) {
      const rect = getOffsetPixelRect(container, pos);
      if (!rect) continue;
      next.push({
        key: String(pos),
        top: rect.top - containerRect.top,
        left: rect.left - containerRect.left,
        height: rect.height || 20,
        users,
      });
    }
    setMarkers(next);
  }, [remoteUsers, docVersion]);

  // Same idea as the marker overlay, but for images: their pixel position
  // has to be recomputed any time the document changes, since text
  // reflow shifts everything after an edit.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const next: ImageOverlay[] = docRef.current.getImagePositions().map((img) => {
      const rect = getOffsetPixelRect(container, img.visibleIndex);
      const containerRect = container.getBoundingClientRect();
      return {
        key: `${img.id.replicaId}-${img.id.counter}`,
        top: rect ? rect.top - containerRect.top : 0,
        left: rect ? rect.left - containerRect.left : 0,
        height: rect?.height || 20,
        src: img.src,
      };
    });
    setImages(next);
  }, [docVersion]);

  const handleInput = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const doc = docRef.current;
    const oldValue = doc.toString();
    const newValue = container.textContent ?? '';
    const { start, deletedCount, inserted } = diff(oldValue, newValue);

    const ops: RgaOp[] = [];
    for (let i = 0; i < deletedCount; i++) ops.push(doc.localDelete(start));
    for (let i = 0; i < inserted.length; i++) ops.push(doc.localInsert(start - 1 + i, inserted[i]));
    for (const op of ops) sendOrQueueOp(op);

    setDocVersion((v) => v + 1);
    sendPresence();
  }, [sendPresence, sendOrQueueOp]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.execCommand('insertText', false, '\n');
    }
  }, []);

  // Pure cursor movement (click, arrow keys) doesn't fire onInput -- needs
  // its own trigger so presence stays accurate even when you're not typing.
  const handleSelectionActivity = useCallback(() => {
    sendPresence();
  }, [sendPresence]);

  const insertImageAtCursor = useCallback(
    (src: string) => {
      const container = containerRef.current;
      if (!container) return;
      const doc = docRef.current;
      const cursorPos = getCaretOffset(container);
      const op = doc.localInsertImage(cursorPos - 1, src);
      sendOrQueueOp(op);
      renderRuns(container, doc.getFormattedRuns());
      setDocVersion((v) => v + 1);
    },
    [sendOrQueueOp]
  );

  // Toggles bold/italic on the current selection. Determines the toggle
  // direction by checking whether the FIRST selected character already
  // has this formatting -- same convention most editors use.
  const toggleMark = useCallback(
    (markType: 'bold' | 'italic') => {
      const container = containerRef.current;
      if (!container) return;
      const sel = getSelectionRange(container);
      if (!sel) return; // nothing selected -- nothing to format

      const doc = docRef.current;
      const runs = doc.getFormattedRuns();
      let idx = 0;
      let currentlyActive = false;
      for (const run of runs) {
        const len = run.text.length;
        if (sel.start >= idx && sel.start < idx + len) {
          currentlyActive = markType === 'bold' ? run.bold : run.italic;
          break;
        }
        idx += len;
      }

      const op = doc.addMark(markType, sel.start, sel.end - 1, !currentlyActive);
      sendOrQueueOp(op);
      renderRuns(container, doc.getFormattedRuns());
      setCaretOffset(container, sel.end); // collapse selection to its end point
      setDocVersion((v) => v + 1);
    },
    [sendOrQueueOp]
  );

  // Sends the delete request directly rather than through sendOrQueueOp --
  // deleting an offline room makes no sense to queue for later, it should
  // only work while genuinely connected.
  const deleteRoom = useCallback(() => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'delete-room' }));
    }
  }, []);

  // "Who's online" strip: self + everyone else currently in the room.
  // Cheap to derive on every render -- no need for its own state/effect.
  const onlineUsers: PresenceInfo[] = [
    { userId: myUserIdRef.current, name: myName, color: myColorRef.current, cursorPos: 0 },
    ...Array.from(remoteUsers.values()),
  ];

  return {
    containerRef,
    handleInput,
    handleKeyDown,
    handleSelectionActivity,
    connected,
    authState,
    markers,
    images,
    insertImageAtCursor,
    toggleMark,
    deleteRoom,
    myUserId: myUserIdRef.current,
    myName,
    setMyName,
    onlineUsers,
  };
}
