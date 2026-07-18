import { useCollabDoc } from './useCollabDoc';

function App() {
  const {
    containerRef,
    handleInput,
    handleKeyDown,
    handleSelectionActivity,
    connected,
    markers,
    myUserId,
    myName,
    setMyName,
    onlineUsers,
  } = useCollabDoc('demo-room');

  return (
    <div style={{ maxWidth: 700, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <h2>Collaborative editor</h2>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <p style={{ color: connected ? 'green' : 'red', margin: 0 }}>
          {connected ? 'connected' : 'disconnected'}
        </p>

        <label style={{ fontSize: 13, color: '#555', display: 'flex', alignItems: 'center', gap: 6 }}>
          Your name:
          <input
            value={myName}
            onChange={(e) => setMyName(e.target.value)}
            style={{ fontSize: 13, padding: '2px 6px', border: '1px solid #ccc', borderRadius: 4, width: 120 }}
          />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {onlineUsers.map((u) => (
          <div
            key={u.userId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: '#f5f5f5',
              borderRadius: 12,
              padding: '3px 10px 3px 3px',
              fontSize: 12,
            }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: u.color,
                color: 'white',
                fontSize: 10,
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {u.name.charAt(0).toUpperCase()}
            </span>
            {u.name}
            {u.userId === myUserId ? ' (you)' : ''}
          </div>
        ))}
      </div>

      <div style={{ position: 'relative' }}>
        <div
          ref={containerRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onClick={handleSelectionActivity}
          onKeyUp={handleSelectionActivity}
          style={{
            width: '100%',
            minHeight: 400,
            fontSize: 16,
            fontFamily: 'monospace',
            padding: 12,
            border: '1px solid #ccc',
            borderRadius: 4,
            whiteSpace: 'pre-wrap',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />

        <div style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
          {markers.map((marker) =>
            marker.users.length === 1 ? (
              <div
                key={marker.key}
                style={{
                  position: 'absolute',
                  top: marker.top,
                  left: marker.left,
                  pointerEvents: 'none',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: -20,
                    left: 0,
                    background: marker.users[0].color,
                    color: 'white',
                    fontSize: 11,
                    padding: '1px 6px',
                    borderRadius: 4,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {marker.users[0].name}
                </span>
                <span
                  style={{
                    display: 'inline-block',
                    width: 2,
                    height: marker.height,
                    background: marker.users[0].color,
                  }}
                />
              </div>
            ) : (
              <div
                key={marker.key}
                title={marker.users.map((u) => u.name).join(', ')}
                style={{
                  position: 'absolute',
                  top: marker.top - 2,
                  left: marker.left,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 2,
                  background: 'white',
                  border: '1px solid #ccc',
                  borderRadius: 10,
                  padding: '1px 7px 1px 3px',
                  fontSize: 11,
                  fontWeight: 500,
                  color: '#555',
                  pointerEvents: 'auto',
                  cursor: 'default',
                }}
              >
                {marker.users.slice(0, 3).map((u, i) => (
                  <span
                    key={u.userId}
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      background: u.color,
                      display: 'inline-block',
                      marginLeft: i === 0 ? 0 : -6,
                      border: '1.5px solid white',
                    }}
                  />
                ))}
                +{marker.users.length}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
