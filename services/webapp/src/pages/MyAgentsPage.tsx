import { useState, useEffect } from 'react';
import { listAgents, deleteAgent, restartAgent, Agent } from '../services/api';

interface Props { onDeploy: () => void; }

const STATUS_LABEL: Record<string, string> = {
  active: '🟢 Live', provisioning: '⏳ Deploying', pairing: '🟡 Pairing',
  stopped: '⚫ Stopped', failed: '🔴 Failed',
};

export default function MyAgentsPage({ onDeploy }: Props) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      setAgents(await listAgents());
    } catch {
      setError('Failed to load agents.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this agent?')) return;
    setBusy(id);
    try { await deleteAgent(id); await load(); }
    catch { alert('Delete failed'); }
    finally { setBusy(null); }
  }

  async function handleRestart(id: string) {
    setBusy(id);
    try { await restartAgent(id); await load(); }
    catch { alert('Restart failed'); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '16px 20px 24px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
        <h2 style={{ fontSize:20, fontWeight:800 }}>My Agents</h2>
        <button onClick={load} style={{ fontSize:13, color:'#2563eb', background:'none', border:'none', padding:0 }}>
          Refresh
        </button>
      </div>

      {loading && <p style={{ color:'#6b7280', textAlign:'center', padding:40 }}>Loading…</p>}
      {error && <p style={{ color:'#dc2626', textAlign:'center' }}>{error}</p>}

      {!loading && agents.length === 0 && (
        <div style={{ textAlign:'center', padding:'40px 0' }}>
          <p style={{ color:'#6b7280', marginBottom:20 }}>No agents yet.</p>
          <button onClick={onDeploy} style={{ padding:'12px 24px', borderRadius:10, background:'#2563eb', color:'#fff', border:'none', fontSize:15, fontWeight:700 }}>
            Deploy your first agent →
          </button>
        </div>
      )}

      {agents.map(agent => (
        <div key={agent.id} style={{
          border:'1px solid #e5e7eb', borderRadius:14, padding:'16px 18px', marginBottom:12,
          background: busy === agent.id ? '#f9fafb' : '#fff',
          opacity: busy === agent.id ? 0.6 : 1,
        }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
            <div>
              <div style={{ fontWeight:700, fontSize:16 }}>{agent.name}</div>
              <div style={{ fontSize:13, color:'#6b7280', fontFamily:'monospace' }}>@{agent.botUsername}</div>
            </div>
            <span style={{ fontSize:13, fontWeight:600 }}>{STATUS_LABEL[agent.status] ?? agent.status}</span>
          </div>

          <div style={{ fontSize:12, color:'#9ca3af', marginBottom:12 }}>
            {agent.provider} · {new Date(agent.createdAt).toLocaleDateString()}
          </div>

          <div style={{ display:'flex', gap:8 }}>
            {agent.status === 'active' && (
              <a href={`https://t.me/${agent.botUsername}`} target="_blank" rel="noreferrer"
                style={{ flex:1, padding:'8px 0', borderRadius:8, background:'#eff6ff', color:'#2563eb', border:'1px solid #bfdbfe', fontSize:13, fontWeight:700, textAlign:'center', textDecoration:'none' }}>
                Open bot
              </a>
            )}
            {(agent.status === 'stopped' || agent.status === 'failed') && (
              <button onClick={() => handleRestart(agent.id)} disabled={!!busy}
                style={{ flex:1, padding:'8px 0', borderRadius:8, background:'#f0fdf4', color:'#16a34a', border:'1px solid #86efac', fontSize:13, fontWeight:700 }}>
                Restart
              </button>
            )}
            <button onClick={() => handleDelete(agent.id)} disabled={!!busy}
              style={{ flex:1, padding:'8px 0', borderRadius:8, background:'#fef2f2', color:'#dc2626', border:'1px solid #fca5a5', fontSize:13, fontWeight:700 }}>
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
