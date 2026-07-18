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

const COLOR_PALETTE = ['#457b9d', '#e63946', '#1d9e75', '#f4a261', '#9b5de5', '#2a9d8f'];
function colorForUserId(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return COLOR_PALETTE[hash % COLOR_PALETTE.length];
}

interface PresenceInfo {
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
  users: PresenceInfo[];
}

export function useCollabDoc(docId: string) {
  const docRef = useRef<RgaDocument>(new RgaDocument(crypto.randomUUID()));
  const socketRef = useRef<WebSocket | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [connected, setConnected] = useState(false);
  const [docVersion, setDocVersion] = useState(0);
  const [remoteUsers, setRemoteUsers] = useState<Map<string, PresenceInfo>>(new Map());
  const [markers, setMarkers] = useState<Marker[]>([]);

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
    }, 120);
  }, [sendPresenceNow]);

  const setMyName = useCallback(
    (name: string) => {
      setMyNameState(name);
      myNameRef.current = name;
      sendPresenceNow();
    },
    [sendPresenceNow]
  );

  useEffect(() => {
    const socket = new WebSocket(`ws://localhost:8080/${docId}`);
    socketRef.current = socket;

    socket.onopen = () => {
      setConnected(true);
      sendPresence();
    };
    socket.onclose = () => setConnected(false);

    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === 'init') {
        docRef.current.loadSnapshot(msg.nodes);
        if (containerRef.current) containerRef.current.textContent = docRef.current.toString();
        setDocVersion((v) => v + 1);
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

      const container = containerRef.current;
      const oldText = docRef.current.toString();
      docRef.current.applyRemote(msg as RgaOp);
      const newText = docRef.current.toString();

      if (container) {
        const { start, deletedCount, inserted } = diff(oldText, newText);
        const currentCursor = getCaretOffset(container);
        let adjustedCursor = currentCursor;
        if (currentCursor > start) {
          adjustedCursor = Math.max(start, currentCursor + (inserted.length - deletedCount));
        }
        container.textContent = newText;
        setCaretOffset(container, adjustedCursor);
      }
      setDocVersion((v) => v + 1);
    };

    return () => socket.close();
  }, [docId, sendPresence]);

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
    for (const op of ops) socketRef.current?.send(JSON.stringify(op));

    setDocVersion((v) => v + 1);
    sendPresence();
  }, [sendPresence]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.execCommand('insertText', false, '\n');
    }
  }, []);

  const handleSelectionActivity = useCallback(() => {
    sendPresence();
  }, [sendPresence]);

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
    markers,
    myUserId: myUserIdRef.current,
    myName,
    setMyName,
    onlineUsers,
  };
}
