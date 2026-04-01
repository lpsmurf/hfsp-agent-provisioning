import axios, { AxiosInstance } from 'axios';

const BASE = '/api';

function getToken() { return localStorage.getItem('webapp_token'); }
export function setToken(t: string) { localStorage.setItem('webapp_token', t); }
export function clearToken() { localStorage.removeItem('webapp_token'); }
export function hasToken() { return !!getToken(); }

const http: AxiosInstance = axios.create({ baseURL: BASE });

http.interceptors.request.use(cfg => {
  const t = getToken();
  if (t) cfg.headers = { ...cfg.headers, Authorization: `Bearer ${t}` };
  return cfg;
});

// ── Auth ────────────────────────────────────────────────────────────
export async function authWithTelegram(initData: string): Promise<string> {
  const { data } = await http.post('/webapp/auth', { initData });
  setToken(data.token);
  return data.token;
}

// ── Agents ──────────────────────────────────────────────────────────
export interface Agent {
  id: string;
  name: string;
  botUsername: string;
  provider: string;
  status: 'provisioning' | 'pairing' | 'active' | 'stopped' | 'failed';
  createdAt: string;
}

export interface CreateAgentPayload {
  botToken: string;
  botUsername: string;
  provider: 'openai' | 'anthropic' | 'openrouter';
  apiKey: string;
  agentName: string;
}

export async function createAgent(payload: CreateAgentPayload): Promise<Agent> {
  const { data } = await http.post('/webapp/agents', payload);
  return data.agent;
}

export async function listAgents(): Promise<Agent[]> {
  const { data } = await http.get('/webapp/agents');
  return data.agents;
}

export async function deleteAgent(id: string): Promise<void> {
  await http.delete(`/webapp/agents/${id}`);
}

export async function restartAgent(id: string): Promise<void> {
  await http.post(`/webapp/agents/${id}/restart`);
}

export async function pairAgent(id: string, code: string): Promise<{ ok: boolean }> {
  const { data } = await http.post(`/webapp/agents/${id}/pair`, { code });
  return data;
}
