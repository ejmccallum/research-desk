import crypto from 'node:crypto';
import http from 'node:http';
import { safeStorage, shell } from 'electron';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { ChatGptConnectionStatus, ChatGptModel } from '../shared/types.js';

const AUTHORITY = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const DISCOVERY_URL = `${AUTHORITY}/.well-known/openid-configuration`;

type Settings = Record<string, unknown>;
type StoredCredential = {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number;
  earliestRefreshAt: number;
  scope: string;
  subject: string;
  name?: string;
  email?: string;
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  earliest_refresh_at?: number | string;
  scope?: string;
};

type Discovery = { issuer: string; jwks_uri: string; revocation_endpoint?: string };

export const base64Url = (value: Buffer) => value.toString('base64url');
export const makePkce = () => {
  const verifier = base64Url(crypto.randomBytes(64));
  return { verifier, challenge: base64Url(crypto.createHash('sha256').update(verifier).digest()) };
};

export class ChatGptAuth {
  private refreshPromise: Promise<StoredCredential> | null = null;

  constructor(private readSettings: () => Settings, private writeSettings: (settings: Settings) => void) {}

  private decryptCredential(): StoredCredential | null {
    const encrypted = this.readSettings().chatGptCredential;
    if (typeof encrypted !== 'string' || !safeStorage.isEncryptionAvailable()) return null;
    try {
      return JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64'))) as StoredCredential;
    } catch {
      return null;
    }
  }

  private saveCredential(credential: StoredCredential) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable, so ChatGPT sign-in cannot be stored safely.');
    const settings = this.readSettings();
    settings.chatGptCredential = safeStorage.encryptString(JSON.stringify(credential)).toString('base64');
    settings.aiProvider = 'chatgpt';
    this.writeSettings(settings);
  }

  private async discovery(): Promise<Discovery> {
    const response = await fetch(DISCOVERY_URL);
    if (!response.ok) throw new Error(`Could not load OpenAI sign-in configuration (${response.status}).`);
    return response.json() as Promise<Discovery>;
  }

  private async validateIdToken(idToken: string, clientId: string, nonce?: string) {
    const discovery = await this.discovery();
    const { payload } = await jwtVerify(idToken, createRemoteJWKSet(new URL(discovery.jwks_uri)), {
      issuer: discovery.issuer,
      audience: clientId,
      requiredClaims: ['sub', 'exp', 'iat'],
    });
    if (nonce && payload.nonce !== nonce) throw new Error('The ChatGPT sign-in response did not match this request.');
    return payload;
  }

  private async postToken(body: URLSearchParams): Promise<TokenResponse> {
    const response = await fetch(`${AUTHORITY}/api/accounts/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) throw new Error(`ChatGPT authorization failed (${response.status}): ${(await response.text()).slice(0, 240)}`);
    return response.json() as Promise<TokenResponse>;
  }

  private credentialFromToken(token: TokenResponse, claims: Record<string, unknown>, previous?: StoredCredential): StoredCredential {
    const scope = token.scope || previous?.scope || '';
    if (!scope.split(' ').includes('chatgpt.tokens.use.direct')) throw new Error('ChatGPT did not grant permission to use models in this app.');
    const earliest = Number(token.earliest_refresh_at || 0);
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token || previous?.refreshToken || '',
      idToken: token.id_token || previous?.idToken || '',
      expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
      earliestRefreshAt: earliest > 10_000_000_000 ? earliest : earliest * 1000,
      scope,
      subject: String(claims.sub || previous?.subject || ''),
      name: typeof claims.name === 'string' ? claims.name : previous?.name,
      email: typeof claims.email === 'string' ? claims.email : previous?.email,
    };
  }

  async connect(): Promise<ChatGptConnectionStatus> {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable, so ChatGPT sign-in cannot be stored safely.');
    const settings = this.readSettings();
    let hostId = typeof settings.chatGptHostId === 'string' ? settings.chatGptHostId : '';
    if (!hostId) {
      hostId = `urn:uuid:${crypto.randomUUID()}`;
      settings.chatGptHostId = hostId;
      this.writeSettings(settings);
    }

    const state = base64Url(crypto.randomBytes(32));
    const nonce = base64Url(crypto.randomBytes(32));
    const { verifier, challenge } = makePkce();
    const existingClientId = typeof settings.chatGptClientId === 'string' ? settings.chatGptClientId : '';
    const requestedClientId = existingClientId || 'dynamic_agent_client';

    const callback = await new Promise<{ code: string; clientId: string; redirectUri: string }>((resolve, reject) => {
      let settled = false;
      const server = http.createServer((request, response) => {
        try {
          const url = new URL(request.url || '/', 'http://127.0.0.1');
          if (url.pathname !== '/auth/callback') {
            response.writeHead(404).end('Not found');
            return;
          }
          const returnedState = url.searchParams.get('state');
          const error = url.searchParams.get('error');
          const errorDescription = url.searchParams.get('error_description');
          if (error) throw new Error(errorDescription || `ChatGPT sign-in was not completed (${error}).`);
          if (returnedState !== state) throw new Error('The ChatGPT sign-in response did not match this request.');
          const code = url.searchParams.get('code');
          const clientId = url.searchParams.get('client_id') || existingClientId;
          if (!code || !clientId) throw new Error('ChatGPT returned an incomplete authorization response.');
          const port = (server.address() as { port: number }).port;
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          response.end('<!doctype html><title>Research Desk connected</title><style>body{font:16px system-ui;background:#181818;color:#eee;display:grid;place-items:center;height:100vh;margin:0}main{max-width:34rem;padding:2rem}h1{color:#d18b47}</style><main><h1>Research Desk is connected</h1><p>You can close this tab and return to the app.</p></main>');
          settled = true;
          server.close();
          resolve({ code, clientId, redirectUri: `http://127.0.0.1:${port}/auth/callback` });
        } catch (error) {
          response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end(error instanceof Error ? error.message : 'Sign-in failed.');
          settled = true;
          server.close();
          reject(error);
        }
      });
      server.on('error', reject);
      server.listen(0, '127.0.0.1', async () => {
        const port = (server.address() as { port: number }).port;
        const redirectUri = `http://127.0.0.1:${port}/auth/callback`;
        const params = new URLSearchParams({
          response_type: 'code', client_id: requestedClientId, redirect_uri: redirectUri, scope: SCOPES,
          resource: RESOURCE, code_challenge: challenge, code_challenge_method: 'S256', state, nonce,
          ext_agent_host_id: hostId,
        });
        if (!existingClientId) params.set('agent_name_hint', 'Research Desk');
        try { await shell.openExternal(`${AUTHORITY}/api/accounts/authorize?${params}`); }
        catch (error) { server.close(); reject(error); }
      });
      setTimeout(() => { if (!settled) { server.close(); reject(new Error('ChatGPT sign-in timed out. Please try again.')); } }, 5 * 60 * 1000).unref();
    });

    const latest = this.readSettings();
    latest.chatGptClientId = callback.clientId;
    this.writeSettings(latest);
    const token = await this.postToken(new URLSearchParams({
      grant_type: 'authorization_code', client_id: callback.clientId, code: callback.code,
      code_verifier: verifier, redirect_uri: callback.redirectUri, resource: RESOURCE,
    }));
    if (!token.id_token || !token.refresh_token) throw new Error('ChatGPT did not return the required identity and refresh tokens.');
    const claims = await this.validateIdToken(token.id_token, callback.clientId, nonce);
    this.saveCredential(this.credentialFromToken(token, claims as Record<string, unknown>));
    await this.refreshModels();
    return this.status();
  }

  private async refreshCredential(): Promise<StoredCredential> {
    const credential = this.decryptCredential();
    const clientId = this.readSettings().chatGptClientId;
    if (!credential || typeof clientId !== 'string') throw new Error('Your ChatGPT connection is no longer available. Please connect again.');
    if (credential.expiresAt > Date.now() + 120_000) return credential;
    if (credential.earliestRefreshAt && Date.now() < credential.earliestRefreshAt && credential.expiresAt > Date.now()) return credential;
    const token = await this.postToken(new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: credential.refreshToken, resource: RESOURCE }));
    let claims: Record<string, unknown> = { sub: credential.subject, name: credential.name, email: credential.email };
    if (token.id_token) claims = (await this.validateIdToken(token.id_token, clientId)) as Record<string, unknown>;
    const refreshed = this.credentialFromToken(token, claims, credential);
    this.saveCredential(refreshed);
    return refreshed;
  }

  async accessToken() {
    if (!this.refreshPromise) this.refreshPromise = this.refreshCredential().finally(() => { this.refreshPromise = null; });
    return (await this.refreshPromise).accessToken;
  }

  async refreshModels(): Promise<ChatGptModel[]> {
    const response = await fetch(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${await this.accessToken()}` } });
    if (!response.ok) throw new Error(`Could not load models from ChatGPT (${response.status}).`);
    const json = await response.json() as { models?: Array<Record<string, unknown>>; data?: Array<Record<string, unknown>> };
    const source = json.models || json.data || [];
    const models = source
      .filter(model => !('visibility' in model) || model.visibility === 'list')
      .map(model => ({ slug: String(model.slug || model.id || ''), displayName: String(model.display_name || model.name || model.slug || model.id || '') }))
      .filter(model => model.slug && model.displayName);
    const settings = this.readSettings();
    settings.chatGptModels = models;
    if (!models.some(model => model.slug === settings.chatGptModel)) settings.chatGptModel = models[0]?.slug || '';
    this.writeSettings(settings);
    return models;
  }

  setModel(slug: string) {
    const settings = this.readSettings();
    const models = Array.isArray(settings.chatGptModels) ? settings.chatGptModels as ChatGptModel[] : [];
    if (!models.some(model => model.slug === slug)) throw new Error('Choose a model supplied by ChatGPT.');
    settings.chatGptModel = slug;
    settings.aiProvider = 'chatgpt';
    this.writeSettings(settings);
    return this.status();
  }

  status(): ChatGptConnectionStatus {
    const settings = this.readSettings();
    const credential = this.decryptCredential();
    const models = Array.isArray(settings.chatGptModels) ? settings.chatGptModels as ChatGptModel[] : [];
    return {
      connected: Boolean(credential),
      name: credential?.name,
      email: credential?.email,
      models,
      selectedModel: typeof settings.chatGptModel === 'string' ? settings.chatGptModel : '',
    };
  }

  async disconnect() {
    const settings = this.readSettings();
    const credential = this.decryptCredential();
    const clientId = settings.chatGptClientId;
    let warning = '';
    if (credential && typeof clientId === 'string') {
      try {
        const discovery = await this.discovery();
        if (discovery.revocation_endpoint) {
          const response = await fetch(discovery.revocation_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: credential.refreshToken, token_type_hint: 'refresh_token', client_id: clientId }) });
          if (!response.ok) warning = 'The local connection was removed, but OpenAI could not confirm remote token revocation.';
        }
      } catch { warning = 'The local connection was removed, but OpenAI could not confirm remote token revocation.'; }
    }
    delete settings.chatGptCredential;
    delete settings.chatGptModels;
    delete settings.chatGptModel;
    if (settings.aiProvider === 'chatgpt') settings.aiProvider = this.hasApiKey() ? 'api-key' : '';
    this.writeSettings(settings);
    return { ...this.status(), warning };
  }

  private hasApiKey() { return typeof this.readSettings().openAiKey === 'string'; }
}
