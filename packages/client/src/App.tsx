import { useState, useEffect } from 'react';
import './App.css';
import { useCollabDoc } from './useCollabDoc';

function JoinScreen({ onJoin }: { onJoin: (roomId: string, password: string) => void }) {
  const [roomId, setRoomId] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomId.trim() && password) onJoin(roomId.trim(), password);
  };

  return (
    <div className="join-shell">
      <h1 className="wordmark">Inkwell</h1>
      <p className="join-hint">
        Enter a room id and password. The first person to use a given room id sets its password for everyone after.
      </p>
      <form className="join-form" onSubmit={handleSubmit}>
        <input className="join-input" placeholder="Room id" value={roomId} onChange={(e) => setRoomId(e.target.value)} />
        <input
          className="join-input"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="join-btn" type="submit">
          Enter room
        </button>
      </form>
    </div>
  );
}

function Editor({
  roomId,
  password,
  onAuthRejected,
}: {
  roomId: string;
  password: string;
  onAuthRejected: () => void;
}) {
  const {
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
    myUserId,
    myName,
    setMyName,
    onlineUsers,
  } = useCollabDoc(roomId, password);

  useEffect(() => {
    if (authState === 'deleted') {
      window.alert(`Room "${roomId}" was deleted.`);
      onAuthRejected();
      return;
    }
    if (authState === 'rejected') onAuthRejected();
  }, [authState, onAuthRejected, roomId]);

  const handleInsertImage = () => {
    const url = window.prompt('Image URL:');
    if (url) insertImageAtCursor(url);
  };

  const handleDeleteRoom = () => {
    const ok = window.confirm(
      `Delete room "${roomId}" for everyone? This permanently erases the document and cannot be undone.`
    );
    if (ok) deleteRoom();
  };

  if (authState !== 'accepted') {
    return (
      <div className="join-shell">
        <p className="join-hint">Checking password…</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="instrument-bar">
        <h1 className="wordmark">Inkwell</h1>
        <div className="status">
          <span className={`status-dot ${connected ? 'live' : 'offline'}`} />
          {connected ? `live · ${roomId}` : 'reconnecting'}
        </div>
      </header>

      <div className="toolbar">
        <button className="toolbar-btn" style={{ fontWeight: 700 }} onClick={() => toggleMark('bold')} title="Bold selected text">
          B
        </button>
        <button className="toolbar-btn" style={{ fontStyle: 'italic' }} onClick={() => toggleMark('italic')} title="Italicize selected text">
          I
        </button>
        <button className="toolbar-btn" onClick={handleInsertImage}>
          Insert image
        </button>
        <span className="toolbar-spacer" />
        <button className="toolbar-btn toolbar-btn-danger" onClick={handleDeleteRoom} title="Permanently delete this room for everyone">
          Delete room
        </button>
        <label className="name-field">
          you are
          <input className="name-input" value={myName} onChange={(e) => setMyName(e.target.value)} />
        </label>
      </div>

      <div className="presence-strip">
        {onlineUsers.map((u) => (
          <div key={u.userId} className="presence-chip">
            <span className="presence-avatar" style={{ background: u.color }}>
              {u.name.charAt(0).toUpperCase()}
            </span>
            {u.name}
            {u.userId === myUserId ? ' (you)' : ''}
          </div>
        ))}
      </div>

      <div className="editor-wrap">
        <div
          ref={containerRef}
          className="editor-surface"
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onClick={handleSelectionActivity}
          onKeyUp={handleSelectionActivity}
        />

        <div style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
          {markers.map((marker) =>
            marker.users.length === 1 ? (
              <div key={marker.key} className="presence-flag" style={{ top: marker.top, left: marker.left }}>
                <span className="presence-flag-label" style={{ background: marker.users[0].color }}>
                  {marker.users[0].name}
                </span>
                <span className="presence-flag-bar" style={{ height: marker.height, background: marker.users[0].color }} />
              </div>
            ) : (
              <div
                key={marker.key}
                className="presence-cluster"
                title={marker.users.map((u) => u.name).join(', ')}
                style={{ top: marker.top - 2, left: marker.left }}
              >
                {marker.users.slice(0, 3).map((u, i) => (
                  <span
                    key={u.userId}
                    className="presence-cluster-dot"
                    style={{ background: u.color, marginLeft: i === 0 ? 0 : -6 }}
                  />
                ))}
                +{marker.users.length}
              </div>
            )
          )}

          {images.map((img) => (
            <img
              key={img.key}
              src={img.src}
              alt=""
              className="image-overlay"
              style={{ top: img.top, left: img.left, height: 150, width: 'auto', maxWidth: 200 }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [session, setSession] = useState<{ roomId: string; password: string } | null>(null);

  if (!session) {
    return <JoinScreen onJoin={(roomId, password) => setSession({ roomId, password })} />;
  }

  return <Editor roomId={session.roomId} password={session.password} onAuthRejected={() => setSession(null)} />;
}

export default App;
