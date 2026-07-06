import { useEffect, useRef, useState, useCallback, useLayoutEffect } from 'react';
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

  return {
    start,
    deletedCount: oldEnd - start,
    inserted: newStr.slice(start, newEnd),
  };
}

export function useCollabDoc(docId: string) {
  const docRef = useRef<RgaDocument>(new RgaDocument(crypto.randomUUID()));
  const socketRef = useRef<WebSocket | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [text, setText] = useState('');
  const [connected, setConnected] = useState(false);

  const pendingSelectionRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (pendingSelectionRef.current !== null && textareaRef.current) {
      const pos = pendingSelectionRef.current;
      textareaRef.current.setSelectionRange(pos, pos);
      pendingSelectionRef.current = null;
    }
  }, [text]);

  useEffect(() => {
    const socket = new WebSocket(`ws://localhost:8080/${docId}`);
    socketRef.current = socket;

    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);

    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'init') {
        docRef.current.loadSnapshot(msg.nodes);
        setText(docRef.current.toString());
        return;
      }

      const oldText = docRef.current.toString();
      docRef.current.applyRemote(msg as RgaOp);
      const newText = docRef.current.toString();
      const { start, deletedCount, inserted } = diff(oldText, newText);

      const currentCursor = textareaRef.current?.selectionStart ?? newText.length;
      let adjustedCursor = currentCursor;
      if (currentCursor > start) {
        adjustedCursor = Math.max(start, currentCursor + (inserted.length - deletedCount));
      }
      pendingSelectionRef.current = adjustedCursor;

      setText(newText);
    };

    return () => socket.close();
  }, [docId]);

  const handleChange = useCallback((newValue: string) => {
    const doc = docRef.current;
    const oldValue = doc.toString();
    const { start, deletedCount, inserted } = diff(oldValue, newValue);

    const ops: RgaOp[] = [];

    for (let i = 0; i < deletedCount; i++) {
      ops.push(doc.localDelete(start));
    }

    for (let i = 0; i < inserted.length; i++) {
      ops.push(doc.localInsert(start - 1 + i, inserted[i]));
    }

    for (const op of ops) {
      socketRef.current?.send(JSON.stringify(op));
    }

    pendingSelectionRef.current = start + inserted.length;

    setText(doc.toString());
  }, []);

  return { text, handleChange, connected, textareaRef };
}
