import { useState, useEffect } from 'react';
import { authWithTelegram, hasToken } from './services/api';
import WelcomePage from './pages/WelcomePage';
import WizardPage from './pages/WizardPage';
import MyAgentsPage from './pages/MyAgentsPage';

type Tab = 'home' | 'deploy' | 'agents';

declare global {
  interface Window {
    Telegram?: { WebApp?: {
      initData: string;
      ready(): void;
      expand(): void;
      close(): void;
      themeParams: Record<string, string>;
    }};
  }
}

export default function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
    }
    bootstrap();
  }, []);

  async function bootstrap() {
    // Already have token
    if (hasToken()) { setAuthed(true); setLoading(false); return; }
    // Try Telegram initData
    const initData = window.Telegram?.WebApp?.initData;
    if (initData) {
      try {
        await authWithTelegram(initData);
        setAuthed(true);
      } catch {
        setAuthError('Authentication failed. Open this app from Telegram.');
      }
    } else {
      // Dev: no Telegram context — skip auth
      setAuthed(true);
    }
    setLoading(false);
  }

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh' }}>
      <p>Loading…</p>
    </div>
  );

  if (authError) return (
    <div style={{ padding:24, textAlign:'center' }}>
      <p style={{ color:'red' }}>{authError}</p>
    </div>
  );

  if (!authed) return null;

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100vh' }}>
      {/* Page content */}
      <div style={{ flex:1, paddingBottom:60 }}>
        {tab === 'home' && <WelcomePage onDeploy={() => setTab('deploy')} />}
        {tab === 'deploy' && <WizardPage onDone={() => setTab('agents')} />}
        {tab === 'agents' && <MyAgentsPage onDeploy={() => setTab('deploy')} />}
      </div>

      {/* Bottom nav */}
      <nav style={{
        position:'fixed', bottom:0, left:0, right:0,
        display:'flex', background:'#fff',
        borderTop:'1px solid #e5e7eb',
      }}>
        {([['home','🏠','Home'],['deploy','🚀','Deploy'],['agents','🤖','My Agents']] as const).map(([t,icon,label]) => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              flex:1, padding:'10px 0',
              background:'none', border:'none',
              display:'flex', flexDirection:'column', alignItems:'center', gap:2,
              fontSize:11, fontWeight:700,
              color: tab === t ? '#2563eb' : '#6b7280',
            }}>
            <span style={{ fontSize:20 }}>{icon}</span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
