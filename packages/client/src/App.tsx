import { useCollabDoc } from './useCollabDoc';

function App() {
  const { text, handleChange, connected, textareaRef } = useCollabDoc('demo-room');

  return (
    <div style={{ maxWidth: 700, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <h2>Collaborative editor</h2>
      <p style={{ color: connected ? 'green' : 'red' }}>
        {connected ? 'connected' : 'disconnected'}
      </p>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        rows={20}
        style={{ width: '100%', fontSize: 16, fontFamily: 'monospace', padding: 12 }}
      />
    </div>
  );
}

export default App;
