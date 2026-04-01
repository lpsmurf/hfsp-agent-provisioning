import { useState, useEffect, useRef } from 'react';
import { createAgent, pairAgent, Agent } from '../services/api';
import axios from 'axios';

interface Props { onDone: () => void; }

type Step = 'bot' | 'provider' | 'deploy' | 'pairing';
type Provider = 'openai' | 'anthropic' | 'openrouter';

const PROVISION_STEPS = [
  { key: 'validate',   label: 'Validating bot token' },
  { key: 'provision',  label: 'Provisioning container' },
  { key: 'configure',  label: 'Configuring agent' },
  { key: 'start',      label: 'Starting bot' },
  { key: 'ready',      label: 'Agent ready' },
];

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#374151', marginBottom:5, textTransform:'uppercase', letterSpacing:'0.05em' }}>
        {label}
      </label>
      <input {...props} style={{
        width:'100%', padding:'11px 14px', borderRadius:10,
        border:'1px solid #d1d5db', fontSize:14, outline:'none',
        background:'#fff', ...props.style,
      }} />
    </div>
  );
}

export default function WizardPage({ onDone }: Props) {
  const [step, setStep] = useState<Step>('bot');

  // Step 1
  const [botToken, setBotToken] = useState('');
  const [botUsername, setBotUsername] = useState('');
  const [agentName, setAgentName] = useState('');
  const [botError, setBotError] = useState('');
  const [validating, setValidating] = useState(false);

  // Step 2
  const [provider, setProvider] = useState<Provider | ''>('');
  const [apiKey, setApiKey] = useState('');
  const [provError, setProvError] = useState('');

  // Step 3
  const [agent, setAgent] = useState<Agent | null>(null);
  const [deployError, setDeployError] = useState('');
  const [provisionSteps, setProvisionSteps] = useState<Record<string, 'pending'|'active'|'done'|'failed'>>({
    validate:'pending', provision:'pending', configure:'pending', start:'pending', ready:'pending'
  });
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Step 4
  const [pairCode, setPairCode] = useState('');
  const [pairError, setPairError] = useState('');
  const [pairLoading, setPairLoading] = useState(false);
  const [pairSuccess, setPairSuccess] = useState(false);
  const [countdown, setCountdown] = useState(120); // 2 min
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    wsRef.current?.close();
    if (timerRef.current) clearInterval(timerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
  }, []);

  // Start 2-min countdown when pairing step begins
  useEffect(() => {
    if (step !== 'pairing') return;
    setCountdown(120);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(countdownRef.current!); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [step]);

  // ── Step 1: validate via backend (avoids CORS) ───────────────────
  async function validateBot() {
    setBotError('');
    if (!agentName.trim()) { setBotError('Agent name is required'); return; }
    if (!botToken.trim()) { setBotError('Bot token is required'); return; }

    setValidating(true);
    try {
      const { data } = await axios.post('/api/webapp/validate-bot', { botToken: botToken.trim() });
      if (!data.ok) { setBotError(data.error ?? 'Invalid bot token'); return; }

      // Auto-fill username from Telegram if not entered, or verify match
      const tgUsername: string = data.username;
      if (botUsername.trim()) {
        const entered = botUsername.trim().replace('@','').toLowerCase();
        if (entered !== tgUsername.toLowerCase()) {
          setBotError(`Token belongs to @${tgUsername}, not @${botUsername.replace('@','')}`);
          return;
        }
      } else {
        setBotUsername(tgUsername);
      }
      setStep('provider');
    } catch (e: unknown) {
      const msg = axios.isAxiosError(e) ? e.response?.data?.error : 'Validation failed';
      setBotError(msg ?? 'Validation failed');
    } finally {
      setValidating(false);
    }
  }

  // ── Step 2 ───────────────────────────────────────────────────────
  function goToDeploy() {
    if (!provider) { setProvError('Select a provider'); return; }
    if (!apiKey.trim()) { setProvError('API key is required'); return; }
    setProvError('');
    setStep('deploy');
  }

  // ── Step 3: deploy ────────────────────────────────────────────────
  async function deploy() {
    setDeployError('');
    try {
      const created = await createAgent({
        botToken: botToken.trim(),
        botUsername: (botUsername.trim() || '').replace('@',''),
        provider: provider as Provider,
        apiKey: apiKey.trim(),
        agentName: agentName.trim(),
      });
      setAgent(created);
      connectWs(created.id);
    } catch (e: unknown) {
      const msg = axios.isAxiosError(e) ? e.response?.data?.error?.message : (e instanceof Error ? e.message : 'Deployment failed');
      setDeployError(msg ?? 'Deployment failed');
    }
  }

  function connectWs(agentId: string) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?agentId=${agentId}`);
    wsRef.current = ws;

    const keys = ['validate','provision','configure','start','ready'];
    let i = 0;
    const interval = setInterval(() => {
      if (i < keys.length) {
        if (i > 0) setProvisionSteps(prev => ({ ...prev, [keys[i-1]]: 'done' }));
        setProvisionSteps(prev => ({ ...prev, [keys[i]]: 'active' }));
        i++;
      }
    }, 3000);
    timerRef.current = interval;

    ws.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);
        setProvisionSteps(prev => ({ ...prev, [evt.step]: evt.status }));
        if (evt.step === 'ready' && evt.status === 'done') {
          clearInterval(interval);
          setTimeout(() => setStep('pairing'), 800);
        }
        if (evt.status === 'failed') {
          clearInterval(interval);
          setDeployError(evt.message || 'Provisioning failed');
        }
      } catch {}
    };

    ws.onclose = () => {
      clearInterval(interval);
      // Fallback: if ws closes with no failure, assume done after a beat
      setTimeout(() => {
        setProvisionSteps(prev => {
          const hasFailed = Object.values(prev).some(s => s === 'failed');
          if (!hasFailed) {
            const next: Record<string, string> = {};
            keys.forEach(k => { next[k] = 'done'; });
            setTimeout(() => setStep('pairing'), 600);
            return next as any;
          }
          return prev;
        });
      }, 2000);
    };
  }

  // ── Step 4: pair ──────────────────────────────────────────────────
  async function pair() {
    if (!pairCode.trim()) { setPairError('Enter the pairing code'); return; }
    if (!agent) return;
    setPairError('');
    setPairLoading(true);
    try {
      const result = await pairAgent(agent.id, pairCode.trim());
      if (result.ok) { setPairSuccess(true); setTimeout(onDone, 1500); }
      else setPairError('Invalid code. Check the message from your bot.');
    } catch {
      setPairError('Failed to verify code. Try again.');
    } finally {
      setPairLoading(false);
    }
  }

  const stepIndex = { bot:0, provider:1, deploy:2, pairing:3 }[step];
  const progress = Math.round(((stepIndex + 1) / 4) * 100);

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '16px 20px 24px' }}>
      {/* Progress */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6, fontSize:12, color:'#6b7280' }}>
          <span>Step {stepIndex + 1} of 4</span><span>{progress}%</span>
        </div>
        <div style={{ height:6, background:'#e5e7eb', borderRadius:99 }}>
          <div style={{ height:'100%', background:'#2563eb', borderRadius:99, width:`${progress}%`, transition:'width 0.4s' }} />
        </div>
      </div>

      {/* ── STEP 1: Bot Setup ─────────────────────────────────────── */}
      {step === 'bot' && (
        <div>
          <h2 style={{ fontSize:20, fontWeight:800, marginBottom:6 }}>Bot setup</h2>
          <p style={{ fontSize:14, color:'#6b7280', marginBottom:20 }}>You need a fresh Telegram bot from BotFather.</p>

          <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:10, padding:14, marginBottom:20, fontSize:13, color:'#1e40af' }}>
            <strong>How to get a bot token:</strong>
            <ol style={{ marginTop:6, paddingLeft:18, lineHeight:2 }}>
              <li>Open <strong>@BotFather</strong> in Telegram</li>
              <li>Send <code>/newbot</code> and follow instructions</li>
              <li>Copy the token and paste below</li>
            </ol>
          </div>

          <Field label="Agent name" placeholder="My Assistant" value={agentName} onChange={e => setAgentName(e.target.value)} />
          <Field label="Bot token" placeholder="1234567890:ABC..." value={botToken} onChange={e => setBotToken(e.target.value)} style={{ fontFamily:'monospace' }} />
          <Field label="Bot username (optional — auto-detected)" placeholder="@myassistant_bot" value={botUsername} onChange={e => setBotUsername(e.target.value)} />

          {botError && <p style={{ color:'#dc2626', fontSize:13, marginBottom:12 }}>{botError}</p>}

          <button onClick={validateBot} disabled={validating} style={{
            width:'100%', padding:'13px 0', borderRadius:10,
            background: validating ? '#93c5fd' : '#2563eb',
            color:'#fff', border:'none', fontSize:15, fontWeight:700,
          }}>
            {validating ? 'Validating…' : 'Continue →'}
          </button>
        </div>
      )}

      {/* ── STEP 2: Provider ──────────────────────────────────────── */}
      {step === 'provider' && (
        <div>
          <h2 style={{ fontSize:20, fontWeight:800, marginBottom:6 }}>LLM Provider</h2>
          <p style={{ fontSize:14, color:'#6b7280', marginBottom:20 }}>Choose the AI provider for your agent.</p>

          <div style={{ display:'grid', gap:10, marginBottom:20 }}>
            {([
              ['openai',     '🟢', 'OpenAI',      'GPT-4o, GPT-4'],
              ['anthropic',  '🟣', 'Anthropic',   'Claude 3.5, Claude 3'],
              ['openrouter', '🔷', 'OpenRouter',  'Multi-provider gateway'],
            ] as const).map(([val, icon, name, desc]) => (
              <button key={val} onClick={() => setProvider(val)} style={{
                display:'flex', alignItems:'center', gap:14, padding:'14px 16px',
                border: provider === val ? '2px solid #2563eb' : '1px solid #d1d5db',
                borderRadius:12, background: provider === val ? '#eff6ff' : '#fff',
                textAlign:'left', cursor:'pointer',
              }}>
                <span style={{ fontSize:28 }}>{icon}</span>
                <div>
                  <div style={{ fontWeight:700, fontSize:15 }}>{name}</div>
                  <div style={{ fontSize:12, color:'#6b7280' }}>{desc}</div>
                </div>
                {provider === val && <span style={{ marginLeft:'auto', color:'#2563eb', fontWeight:900 }}>✓</span>}
              </button>
            ))}
          </div>

          {provider && (
            <Field
              label={`${provider === 'openai' ? 'OpenAI' : provider === 'anthropic' ? 'Anthropic' : 'OpenRouter'} API key`}
              placeholder="sk-..."
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              style={{ fontFamily:'monospace' }}
            />
          )}

          {provError && <p style={{ color:'#dc2626', fontSize:13, marginBottom:12 }}>{provError}</p>}

          <div style={{ display:'flex', gap:10 }}>
            <button onClick={() => setStep('bot')} style={{ flex:1, padding:'13px 0', borderRadius:10, background:'#f3f4f6', border:'1px solid #d1d5db', fontSize:15, fontWeight:700, color:'#374151' }}>← Back</button>
            <button onClick={goToDeploy} style={{ flex:2, padding:'13px 0', borderRadius:10, background:'#2563eb', color:'#fff', border:'none', fontSize:15, fontWeight:700 }}>Continue →</button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Deploy ────────────────────────────────────────── */}
      {step === 'deploy' && (
        <div>
          <h2 style={{ fontSize:20, fontWeight:800, marginBottom:6 }}>Deploy</h2>
          <p style={{ fontSize:14, color:'#6b7280', marginBottom:20 }}>Ready to launch <strong>{agentName}</strong>.</p>

          {!agent && !deployError && (
            <>
              <div style={{ background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:12, padding:16, marginBottom:20, fontSize:13, color:'#374151', lineHeight:2 }}>
                <div>🤖 <strong>Bot:</strong> @{(botUsername || '').replace('@','')}</div>
                <div>🧠 <strong>Provider:</strong> {provider}</div>
                <div>📛 <strong>Name:</strong> {agentName}</div>
              </div>
              <div style={{ display:'flex', gap:10 }}>
                <button onClick={() => setStep('provider')} style={{ flex:1, padding:'13px 0', borderRadius:10, background:'#f3f4f6', border:'1px solid #d1d5db', fontSize:15, fontWeight:700, color:'#374151' }}>← Back</button>
                <button onClick={deploy} style={{ flex:2, padding:'13px 0', borderRadius:10, background:'#16a34a', color:'#fff', border:'none', fontSize:15, fontWeight:700 }}>🚀 Deploy now</button>
              </div>
            </>
          )}

          {agent && (
            <div>
              {PROVISION_STEPS.map(s => {
                const status = provisionSteps[s.key];
                return (
                  <div key={s.key} style={{
                    display:'flex', alignItems:'center', gap:12, padding:'12px 14px',
                    borderRadius:10, marginBottom:8,
                    background: status==='done' ? '#f0fdf4' : status==='active' ? '#eff6ff' : status==='failed' ? '#fef2f2' : '#f9fafb',
                    border: `1px solid ${status==='done' ? '#86efac' : status==='active' ? '#bfdbfe' : status==='failed' ? '#fca5a5' : '#e5e7eb'}`,
                  }}>
                    <span style={{ fontSize:18 }}>{status==='done' ? '✅' : status==='active' ? '⏳' : status==='failed' ? '❌' : '⬜'}</span>
                    <span style={{ fontSize:14, fontWeight:500, flex:1 }}>{s.label}</span>
                    {status==='active' && <span style={{ fontSize:12, color:'#2563eb' }}>running…</span>}
                  </div>
                );
              })}
            </div>
          )}

          {deployError && (
            <div style={{ background:'#fef2f2', border:'1px solid #fca5a5', borderRadius:10, padding:14, marginTop:12 }}>
              <p style={{ color:'#dc2626', fontSize:13 }}>{deployError}</p>
              <button onClick={() => { setDeployError(''); setAgent(null); }} style={{ marginTop:10, padding:'8px 16px', borderRadius:8, background:'#dc2626', color:'#fff', border:'none', fontSize:13 }}>Retry</button>
            </div>
          )}
        </div>
      )}

      {/* ── STEP 4: Pairing ───────────────────────────────────────── */}
      {step === 'pairing' && (
        <div>
          <h2 style={{ fontSize:20, fontWeight:800, marginBottom:6 }}>Pair your bot</h2>
          <p style={{ fontSize:14, color:'#6b7280', marginBottom:20 }}>Your agent is deployed. Now link it to your account.</p>

          <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:12, padding:16, marginBottom:20 }}>
            <p style={{ fontSize:14, fontWeight:700, color:'#15803d', marginBottom:8 }}>✅ Agent deployed!</p>
            <p style={{ fontSize:13, color:'#166534', lineHeight:1.7 }}>
              1. Open <strong>@{(botUsername || '').replace('@','')}</strong> in Telegram<br />
              2. Send <code>/start</code><br />
              3. Your bot will reply with a pairing code — paste it below
            </p>
          </div>

          {countdown > 0 && (
            <div style={{ background:'#fffbeb', border:'1px solid #fde68a', borderRadius:12, padding:14, marginBottom:16, display:'flex', alignItems:'center', gap:12 }}>
              <span style={{ fontSize:22 }}>⏳</span>
              <div>
                <p style={{ fontSize:13, fontWeight:700, color:'#92400e' }}>
                  Bot is starting up — {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2,'0')} remaining
                </p>
                <p style={{ fontSize:12, color:'#b45309', marginTop:2 }}>
                  Send /start after the countdown. Your bot will reply with the pairing code.
                </p>
              </div>
            </div>
          )}
          {countdown === 0 && (
            <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:12, padding:14, marginBottom:16, display:'flex', alignItems:'center', gap:12 }}>
              <span style={{ fontSize:22 }}>🟢</span>
              <p style={{ fontSize:13, fontWeight:700, color:'#1e40af' }}>Bot should be ready — send /start now!</p>
            </div>
          )}

          <div style={{ marginBottom:16 }}>
            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#374151', marginBottom:5, textTransform:'uppercase', letterSpacing:'0.05em' }}>Pairing code</label>
            <input
              value={pairCode}
              onChange={e => setPairCode(e.target.value.toUpperCase())}
              placeholder="XXXX-XXXX"
              maxLength={9}
              style={{ width:'100%', padding:'13px 16px', borderRadius:10, border:'1px solid #d1d5db', fontSize:20, fontWeight:700, fontFamily:'monospace', letterSpacing:'0.15em', textAlign:'center', outline:'none' }}
            />
          </div>

          {pairError && <p style={{ color:'#dc2626', fontSize:13, marginBottom:12 }}>{pairError}</p>}
          {pairSuccess && (
            <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:10, padding:14, textAlign:'center', fontSize:15, fontWeight:700, color:'#15803d', marginBottom:12 }}>
              🎉 Paired! Your agent is live.
            </div>
          )}

          <button onClick={pair} disabled={pairLoading || pairSuccess} style={{
            width:'100%', padding:'13px 0', borderRadius:10,
            background: pairSuccess ? '#16a34a' : '#2563eb',
            color:'#fff', border:'none', fontSize:15, fontWeight:700,
            opacity: pairLoading ? 0.7 : 1,
          }}>
            {pairLoading ? 'Verifying…' : pairSuccess ? '✓ Live!' : 'Confirm pairing'}
          </button>
        </div>
      )}
    </div>
  );
}
