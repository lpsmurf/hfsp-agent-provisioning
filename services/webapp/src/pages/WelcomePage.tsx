interface Props { onDeploy: () => void; }

export default function WelcomePage({ onDeploy }: Props) {
  return (
    <div style={{ padding: 24, maxWidth: 480, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', paddingTop: 40, paddingBottom: 32 }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>🤖</div>
        <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 8 }}>Clawdrop</h1>
        <p style={{ fontSize: 16, color: '#6b7280', marginBottom: 4 }}>
          Deploy your OpenClaw agent
        </p>
        <p style={{ fontSize: 14, color: '#9ca3af' }}>1 minute setup</p>
      </div>

      <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginBottom: 24 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>What is Clawdrop?</h2>
        <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.6 }}>
          Clawdrop deploys your personal AI agent on Telegram in seconds.
          Connect your own bot, pick an LLM provider, and your agent goes live — powered by OpenClaw.
        </p>
      </div>

      <div style={{ marginBottom: 24 }}>
        {['🤖 Your own Telegram bot', '🧠 OpenAI, Anthropic, or OpenRouter', '⚡ Live in under 60 seconds'].map(item => (
          <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', fontSize: 14, color: '#374151' }}>
            {item}
          </div>
        ))}
      </div>

      <button onClick={onDeploy} style={{
        width: '100%', padding: '15px 0', borderRadius: 12,
        background: '#2563eb', color: '#fff', border: 'none',
        fontSize: 16, fontWeight: 700,
      }}>
        Start deployment →
      </button>
    </div>
  );
}
