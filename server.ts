import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  AccessMode,
  PeerStatus,
  PeerSummary,
  SavedContact,
  SessionHistoryEntry,
} from './src/types/teamdesk.ts';
import { registerVartexTeamRoute } from './server-routes/vartex-team-sync.ts';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.TEAMDESK_DATA_DIR || __dirname;
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch {
  // ignore
}
const DATA_FILE = path.resolve(DATA_DIR, '.teamdesk-store.json');

interface PeerRecord extends PeerSummary {
  ws: WebSocket;
  agentWs: WebSocket | null;
  agentToken: string;
  pinCode: string;
}

interface ActiveSessionRecord {
  id: string;
  hostPeerId: string;
  viewerPeerId: string;
  mode: AccessMode;
  startedAt: string;
  accepted: boolean;
}

interface PersistedStore {
  contacts: SavedContact[];
  sessions: SessionHistoryEntry[];
}

function loadStore(): PersistedStore {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedStore>;
      return {
        contacts: Array.isArray(parsed.contacts) ? parsed.contacts : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      };
    }
  } catch {
    // Ignore malformed store and start fresh
  }
  return { contacts: [], sessions: [] };
}

function saveStore(store: PersistedStore): void {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch {
    // Non-fatal in read-only environments
  }
}

const store: PersistedStore = loadStore();
const peers = new Map<string, PeerRecord>();
const activeSessions = new Map<string, ActiveSessionRecord>();

function normalizePeerId(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 9);
  if (digits.length === 9) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}`;
  }
  return raw.trim();
}

function generatePeerId(): string {
  for (let i = 0; i < 20; i++) {
    const n = crypto.randomInt(100000000, 999999999).toString();
    const formatted = `${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6, 9)}`;
    if (!peers.has(formatted)) return formatted;
  }
  return `${Date.now().toString().slice(-9, -6)}-${Date.now().toString().slice(-6, -3)}-${Date.now().toString().slice(-3)}`;
}

function toPeerSummary(peer: PeerRecord): PeerSummary {
  return {
    peerId: peer.peerId,
    displayName: peer.displayName,
    workspaceCode: peer.workspaceCode,
    roleTitle: peer.roleTitle,
    osPlatform: peer.osPlatform,
    status: peer.status,
    unattendedEnabled: peer.unattendedEnabled,
    hasCompanionAgent: peer.agentWs !== null && peer.agentWs.readyState === WebSocket.OPEN,
    isSharingScreen: peer.isSharingScreen,
    connectedAt: peer.connectedAt,
  };
}

function sendWs(ws: WebSocket | null, event: string, payload: unknown): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event, payload }));
  }
}

function broadcastWorkspacePeers(workspaceCode: string): void {
  const roomPeers: PeerSummary[] = [];
  for (const peer of peers.values()) {
    if (peer.workspaceCode === workspaceCode) {
      roomPeers.push(toPeerSummary(peer));
    }
  }
  for (const peer of peers.values()) {
    if (peer.workspaceCode === workspaceCode) {
      sendWs(peer.ws, 'peer:directory', { peers: roomPeers });
    }
  }
}

function recordSessionStart(entry: SessionHistoryEntry): void {
  const existingIdx = store.sessions.findIndex((s) => s.id === entry.id);
  if (existingIdx >= 0) {
    store.sessions[existingIdx] = entry;
  } else {
    store.sessions.unshift(entry);
    if (store.sessions.length > 200) {
      store.sessions = store.sessions.slice(0, 200);
    }
  }
  saveStore(store);
}

function finalizeSession(
  sessionId: string,
  status: 'completed' | 'declined' | 'failed',
  reason?: string
): void {
  const sess = activeSessions.get(sessionId);
  if (!sess) return;
  activeSessions.delete(sessionId);

  const endedAt = new Date().toISOString();
  const durationSeconds = Math.max(
    0,
    Math.round((Date.now() - new Date(sess.startedAt).getTime()) / 1000)
  );

  const histIdx = store.sessions.findIndex((s) => s.id === sessionId);
  if (histIdx >= 0) {
    store.sessions[histIdx] = {
      ...store.sessions[histIdx],
      status,
      endedAt,
      durationSeconds,
    };
    saveStore(store);
  }

  const host = peers.get(sess.hostPeerId);
  const viewer = peers.get(sess.viewerPeerId);

  if (host && host.status === 'in-session') {
    host.status = host.isSharingScreen ? 'sharing' : 'available';
    broadcastWorkspacePeers(host.workspaceCode);
  }
  if (viewer && viewer.status === 'in-session') {
    viewer.status = viewer.isSharingScreen ? 'sharing' : 'available';
    broadcastWorkspacePeers(viewer.workspaceCode);
  }

  sendWs(host?.ws ?? null, 'session:ended', { sessionId, status, reason });
  sendWs(viewer?.ws ?? null, 'session:ended', { sessionId, status, reason });
}

function buildWindowsPs1Agent(wsUrl: string, peerId: string, token: string): string {
  return `# TeamDesk Local Desktop Control Agent (Windows PowerShell)
# Peer ID: ${peerId}
# Connects to TeamDesk signaling bridge so authorized teammates can control OS mouse & keyboard.
param(
  [string]$ServerUrl = "${wsUrl}",
  [string]$PeerId = "${peerId}",
  [string]$Token = "${token}"
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Win32Code = @"
using System;
using System.Runtime.InteropServices;

public class TeamDeskInput {
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);

  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
  public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
  public const uint MOUSEEVENTF_WHEEL = 0x0800;

  public static void LeftClick(int x, int y) {
    SetCursorPos(x, y);
    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
  }

  public static void RightClick(int x, int y) {
    SetCursorPos(x, y);
    mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, UIntPtr.Zero);
    mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, UIntPtr.Zero);
  }

  public static void Scroll(int delta) {
    mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, UIntPtr.Zero);
  }
}
"@
Add-Type -TypeDefinition $Win32Code -Language CSharp

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$screenW = $bounds.Width
$screenH = $bounds.Height

$fullUrl = "$($ServerUrl)?role=agent&peerId=$([uri]::EscapeDataString($PeerId))&token=$([uri]::EscapeDataString($Token))"
Write-Host "Connecting TeamDesk Companion Agent for Peer $PeerId..." -ForegroundColor Cyan
Write-Host "Screen Resolution: $($screenW)x$($screenH)" -ForegroundColor Gray

while ($true) {
  $ws = New-Object System.Net.WebSockets.ClientWebSocket
  $cts = New-Object System.Threading.CancellationTokenSource
  try {
    $ws.ConnectAsync([Uri]$fullUrl, $cts.Token).GetAwaiter().GetResult()
    Write-Host "Connected! Authorized team sessions can now control this desktop. Press Ctrl+C to stop." -ForegroundColor Green

    $buffer = New-Object byte[] 16384
    while ($ws.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
      $seg = New-Object System.ArraySegment[byte] -ArgumentList @(,$buffer)
      $res = $ws.ReceiveAsync($seg, $cts.Token).GetAwaiter().GetResult()
      if ($res.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
        break
      }
      $msgText = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $res.Count)
      $msg = $msgText | ConvertFrom-Json
      if ($msg.event -eq "agent:input") {
        $ev = $msg.payload
        $x = if ($null -ne $ev.xNorm) { [int]([math]::Round([double]$ev.xNorm * $screenW)) } else { 0 }
        $y = if ($null -ne $ev.yNorm) { [int]([math]::Round([double]$ev.yNorm * $screenH)) } else { 0 }
        switch ($ev.kind) {
          "mouse_move" { [TeamDeskInput]::SetCursorPos($x, $y) | Out-Null }
          "mouse_click" { [TeamDeskInput]::LeftClick($x, $y) }
          "mouse_dblclick" {
            [TeamDeskInput]::LeftClick($x, $y)
            Start-Sleep -Milliseconds 60
            [TeamDeskInput]::LeftClick($x, $y)
          }
          "mouse_rightclick" { [TeamDeskInput]::RightClick($x, $y) }
          "mouse_scroll" {
            $wheel = if ($ev.deltaY -gt 0) { -120 } else { 120 }
            [TeamDeskInput]::Scroll($wheel)
          }
          "type_text" {
            if ($ev.text) {
              $escaped = [System.Text.RegularExpressions.Regex]::Replace($ev.text, '[+^%~(){}\\[\\]]', '{$0}')
              [System.Windows.Forms.SendKeys]::SendWait($escaped)
            }
          }
          "key_tap" {
            $keyMap = @{
              "Enter" = "{ENTER}"
              "Backspace" = "{BACKSPACE}"
              "Tab" = "{TAB}"
              "Escape" = "{ESC}"
              "Delete" = "{DELETE}"
              "ArrowUp" = "{UP}"
              "ArrowDown" = "{DOWN}"
              "ArrowLeft" = "{LEFT}"
              "ArrowRight" = "{RIGHT}"
              "Home" = "{HOME}"
              "End" = "{END}"
              "PageUp" = "{PGUP}"
              "PageDown" = "{PGDN}"
            }
            if ($keyMap.ContainsKey($ev.key)) {
              [System.Windows.Forms.SendKeys]::SendWait($keyMap[$ev.key])
            } elseif ($ev.key -and $ev.key.Length -eq 1) {
              $escaped = [System.Text.RegularExpressions.Regex]::Replace($ev.key, '[+^%~(){}\\[\\]]', '{$0}')
              [System.Windows.Forms.SendKeys]::SendWait($escaped)
            }
          }
        }
      }
    }
  } catch {
    Write-Host "Disconnected or reconnecting in 3s... ($($_.Exception.Message))" -ForegroundColor Yellow
  } finally {
    if ($ws) { $ws.Dispose() }
  }
  Start-Sleep -Seconds 3
}
`;
}

function buildCrossNodeAgent(wsUrl: string, peerId: string, token: string): string {
  return `#!/usr/bin/env node
// TeamDesk Local Desktop Control Agent (Node.js)
// Works on macOS, Linux, and Windows.
// Optional OS control backend: install "@nut-tree-fork/nut-js" globally or in same folder:
//   npm install ws @nut-tree-fork/nut-js
// Then run: node teamdesk-agent.mjs

import WebSocket from 'ws';

const SERVER_URL = ${JSON.stringify(wsUrl)};
const PEER_ID = ${JSON.stringify(peerId)};
const TOKEN = ${JSON.stringify(token)};

let nut = null;
try {
  nut = await import('@nut-tree-fork/nut-js');
  console.log('[TeamDesk Agent] Loaded @nut-tree-fork/nut-js for native OS input.');
} catch {
  console.log('[TeamDesk Agent] @nut-tree-fork/nut-js not installed. Running in dry-run/log mode.');
  console.log('Install native driver anytime with: npm install @nut-tree-fork/nut-js');
}

function connect() {
  const url = \`\${SERVER_URL}?role=agent&peerId=\${encodeURIComponent(PEER_ID)}&token=\${encodeURIComponent(TOKEN)}\`;
  const ws = new WebSocket(url);

  ws.on('open', () => {
    console.log(\`[TeamDesk Agent] Connected for Peer \${PEER_ID}. Waiting for authorized remote control events...\`);
  });

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.event !== 'agent:input') return;
      const ev = msg.payload;
      if (!nut) {
        console.log('[Input Event]', ev.kind, ev.xNorm ?? '', ev.yNorm ?? '', ev.key ?? ev.text ?? '');
        return;
      }
      const { mouse, keyboard, screen, Button, Key, straightTo, Point } = nut;
      const w = await screen.width();
      const h = await screen.height();
      const x = Math.round((ev.xNorm ?? 0) * w);
      const y = Math.round((ev.yNorm ?? 0) * h);

      if (ev.kind === 'mouse_move') {
        await mouse.setPosition(new Point(x, y));
      } else if (ev.kind === 'mouse_click') {
        await mouse.setPosition(new Point(x, y));
        await mouse.click(Button.LEFT);
      } else if (ev.kind === 'mouse_dblclick') {
        await mouse.setPosition(new Point(x, y));
        await mouse.doubleClick(Button.LEFT);
      } else if (ev.kind === 'mouse_rightclick') {
        await mouse.setPosition(new Point(x, y));
        await mouse.click(Button.RIGHT);
      } else if (ev.kind === 'mouse_scroll') {
        if ((ev.deltaY ?? 0) > 0) await mouse.scrollDown(3);
        else await mouse.scrollUp(3);
      } else if (ev.kind === 'type_text' && ev.text) {
        await keyboard.type(ev.text);
      } else if (ev.kind === 'key_tap' && ev.key) {
        if (ev.key === 'Enter') await keyboard.pressKey(Key.Enter), await keyboard.releaseKey(Key.Enter);
        else if (ev.key === 'Backspace') await keyboard.pressKey(Key.Backspace), await keyboard.releaseKey(Key.Backspace);
        else if (ev.key === 'Tab') await keyboard.pressKey(Key.Tab), await keyboard.releaseKey(Key.Tab);
        else if (ev.key === 'Escape') await keyboard.pressKey(Key.Escape), await keyboard.releaseKey(Key.Escape);
        else if (ev.key.length === 1) await keyboard.type(ev.key);
      }
    } catch (err) {
      console.error('[TeamDesk Agent] Input error:', err.message);
    }
  });

  ws.on('close', () => {
    console.log('[TeamDesk Agent] Disconnected. Retrying in 3s...');
    setTimeout(connect, 3000);
  });

  ws.on('error', () => {
    // Handled by close
  });
}

connect();
`;
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      onlinePeers: peers.size,
      activeSessions: activeSessions.size,
    });
  });
registerVartexTeamRoute(app);
  app.get('/api/ice-servers', (_req, res) => {
    const iceServers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ];
    if (process.env.TURN_URL) {
      iceServers.push({
        urls: process.env.TURN_URL,
        username: process.env.TURN_USER || undefined,
        credential: process.env.TURN_PASS || undefined,
      });
    }
    res.json({ iceServers });
  });

  app.get('/api/workspace', (_req, res) => {
    res.json({
      contacts: store.contacts,
      sessions: store.sessions.slice(0, 50),
    });
  });

  app.post('/api/contacts', (req, res) => {
    const { peerId, displayName, roleTitle, workspaceCode, notes } = req.body as Partial<SavedContact>;
    if (!peerId || !displayName) {
      res.status(400).json({ error: 'peerId and displayName are required' });
      return;
    }
    const normalized = normalizePeerId(peerId);
    const now = new Date().toISOString();
    const existingIdx = store.contacts.findIndex((c) => c.peerId === normalized);
    const contact: SavedContact = {
      peerId: normalized,
      displayName: displayName.trim(),
      roleTitle: (roleTitle || 'Team Member').trim(),
      workspaceCode: (workspaceCode || 'TEAM-CORE').trim().toUpperCase(),
      notes: notes?.trim(),
      addedAt: existingIdx >= 0 ? store.contacts[existingIdx].addedAt : now,
      lastConnectedAt: existingIdx >= 0 ? store.contacts[existingIdx].lastConnectedAt : undefined,
    };

    if (existingIdx >= 0) {
      store.contacts[existingIdx] = contact;
    } else {
      store.contacts.unshift(contact);
    }
    saveStore(store);
    res.json({ contact, contacts: store.contacts });
  });

  app.delete('/api/contacts/:peerId', (req, res) => {
    const normalized = normalizePeerId(req.params.peerId);
    store.contacts = store.contacts.filter((c) => c.peerId !== normalized);
    saveStore(store);
    res.json({ contacts: store.contacts });
  });

  app.get('/api/agent/download', (req, res) => {
    const platform = String(req.query.platform || 'windows-ps1');
    const peerId = normalizePeerId(String(req.query.peerId || ''));
    const peer = peers.get(peerId);
    const token = peer?.agentToken || String(req.query.token || 'preview-token');
    const proto = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
    const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
    const wsUrl = `${proto}://${host}/ws`;

    if (platform === 'cross-node') {
      const content = buildCrossNodeAgent(wsUrl, peerId || '000-000-000', token);
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="teamdesk-agent.mjs"');
      res.send(content);
      return;
    }

    const content = buildWindowsPs1Agent(wsUrl, peerId || '000-000-000', token);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="teamdesk-agent.ps1"');
    res.send(content);
  });

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 10 * 1024 * 1024 });

  // Keepalive ping every 25s so mobile CGNAT and corporate proxies never drop idle WebSockets
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.ping();
      }
    });
  }, 25000);
  wss.on('close', () => clearInterval(heartbeatInterval));

  httpServer.on('upgrade', (request, socket, head) => {
    const reqUrl = new URL(request.url || '/', `http://localhost:${PORT}`);
    if (reqUrl.pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (ws, req) => {
    const urlObj = new URL(req.url || '/ws', `http://localhost:${PORT}`);
    const role = urlObj.searchParams.get('role') || 'client';

    if (role === 'agent') {
      const peerId = normalizePeerId(urlObj.searchParams.get('peerId') || '');
      const token = urlObj.searchParams.get('token') || '';
      const peer = peers.get(peerId);

      if (!peer || peer.agentToken !== token) {
        ws.close(4001, 'Invalid peer or agent token');
        return;
      }

      if (peer.agentWs && peer.agentWs.readyState === WebSocket.OPEN) {
        peer.agentWs.close(4002, 'Replaced by newer agent');
      }
      peer.agentWs = ws;
      sendWs(peer.ws, 'agent:status', { connected: true });
      broadcastWorkspacePeers(peer.workspaceCode);

      ws.on('close', () => {
        if (peer.agentWs === ws) {
          peer.agentWs = null;
          sendWs(peer.ws, 'agent:status', { connected: false });
          broadcastWorkspacePeers(peer.workspaceCode);
        }
      });
      return;
    }

    let currentPeerId: string | null = null;

    ws.on('message', (raw) => {
      let parsed: { event?: string; payload?: Record<string, unknown> };
      try {
        parsed = JSON.parse(raw.toString()) as { event?: string; payload?: Record<string, unknown> };
      } catch {
        return;
      }

      const event = parsed.event;
      const payload = parsed.payload || {};

      if (event === 'peer:register') {
        const requestedId = typeof payload.preferredPeerId === 'string'
          ? normalizePeerId(payload.preferredPeerId)
          : '';
        const peerId =
          requestedId && /^\d{3}-\d{3}-\d{3}$/.test(requestedId) && !peers.has(requestedId)
            ? requestedId
            : generatePeerId();

        if (currentPeerId && peers.has(currentPeerId)) {
          const old = peers.get(currentPeerId)!;
          const oldRoom = old.workspaceCode;
          peers.delete(currentPeerId);
          broadcastWorkspacePeers(oldRoom);
        }

        currentPeerId = peerId;
        const workspaceCode = String(payload.workspaceCode || 'TEAM-CORE').trim().toUpperCase() || 'TEAM-CORE';
        const agentToken = crypto.randomBytes(16).toString('hex');

        const record: PeerRecord = {
          peerId,
          displayName: String(payload.displayName || 'Team Member').trim().slice(0, 40) || 'Team Member',
          workspaceCode,
          roleTitle: String(payload.roleTitle || 'Member').trim().slice(0, 40) || 'Member',
          osPlatform: String(payload.osPlatform || 'Web').trim().slice(0, 32),
          status: (payload.status as PeerStatus) || 'available',
          unattendedEnabled: Boolean(payload.unattendedEnabled),
          hasCompanionAgent: false,
          isSharingScreen: Boolean(payload.isSharingScreen),
          connectedAt: new Date().toISOString(),
          ws,
          agentWs: null,
          agentToken,
          pinCode: String(payload.pinCode || '').trim(),
        };

        peers.set(peerId, record);
        sendWs(ws, 'peer:registered', {
          peer: toPeerSummary(record),
          agentToken,
        });
        broadcastWorkspacePeers(workspaceCode);
        return;
      }

      if (!currentPeerId || !peers.has(currentPeerId)) return;
      const self = peers.get(currentPeerId)!;

      if (event === 'peer:update') {
        const prevRoom = self.workspaceCode;
        if (typeof payload.displayName === 'string' && payload.displayName.trim()) {
          self.displayName = payload.displayName.trim().slice(0, 40);
        }
        if (typeof payload.roleTitle === 'string' && payload.roleTitle.trim()) {
          self.roleTitle = payload.roleTitle.trim().slice(0, 40);
        }
        if (typeof payload.workspaceCode === 'string' && payload.workspaceCode.trim()) {
          self.workspaceCode = payload.workspaceCode.trim().toUpperCase().slice(0, 24);
        }
        if (typeof payload.status === 'string') {
          self.status = payload.status as PeerStatus;
        }
        if (typeof payload.unattendedEnabled === 'boolean') {
          self.unattendedEnabled = payload.unattendedEnabled;
        }
        if (typeof payload.pinCode === 'string') {
          self.pinCode = payload.pinCode.trim();
        }
        if (typeof payload.isSharingScreen === 'boolean') {
          self.isSharingScreen = payload.isSharingScreen;
          if (self.status !== 'in-session') {
            self.status = self.isSharingScreen ? 'sharing' : 'available';
          }
        }

        sendWs(self.ws, 'peer:updated', { peer: toPeerSummary(self) });
        if (prevRoom !== self.workspaceCode) {
          broadcastWorkspacePeers(prevRoom);
        }
        broadcastWorkspacePeers(self.workspaceCode);
        return;
      }

      if (event === 'session:request') {
        const targetId = normalizePeerId(String(payload.targetPeerId || ''));
        const pin = String(payload.pin || '').trim();
        const requestedMode = (payload.mode as AccessMode) || 'assist';
        const target = peers.get(targetId);

        if (!target) {
          sendWs(self.ws, 'session:error', {
            code: 'PEER_OFFLINE',
            message: `Peer ${targetId} is not currently online.`,
          });
          return;
        }

        if (target.peerId === self.peerId) {
          sendWs(self.ws, 'session:error', {
            code: 'SELF_CONNECT',
            message: 'You cannot connect to your own Peer ID.',
          });
          return;
        }

        if (target.status === 'busy') {
          sendWs(self.ws, 'session:error', {
            code: 'PEER_BUSY',
            message: `${target.displayName} is currently set to Do Not Disturb.`,
          });
          return;
        }

        const sessionId = crypto.randomUUID();
        const startedAt = new Date().toISOString();
        const pinMatches =
          target.unattendedEnabled && target.pinCode.length >= 4 && pin === target.pinCode;

        if (pin && target.pinCode && pin !== target.pinCode && target.unattendedEnabled) {
          sendWs(self.ws, 'session:error', {
            code: 'INVALID_PIN',
            message: 'Incorrect security PIN for unattended access.',
          });
          return;
        }

        const sessionRec: ActiveSessionRecord = {
          id: sessionId,
          hostPeerId: target.peerId,
          viewerPeerId: self.peerId,
          mode: requestedMode,
          startedAt,
          accepted: pinMatches,
        };
        activeSessions.set(sessionId, sessionRec);

        recordSessionStart({
          id: sessionId,
          hostPeerId: target.peerId,
          hostName: target.displayName,
          viewerPeerId: self.peerId,
          viewerName: self.displayName,
          mode: requestedMode,
          startedAt,
          status: 'active',
        });

        // Update saved contact timestamp if present
        const cIdx = store.contacts.findIndex((c) => c.peerId === target.peerId);
        if (cIdx >= 0) {
          store.contacts[cIdx].lastConnectedAt = startedAt;
          saveStore(store);
        }

        if (pinMatches) {
          target.status = 'in-session';
          self.status = 'in-session';
          broadcastWorkspacePeers(target.workspaceCode);
          if (self.workspaceCode !== target.workspaceCode) {
            broadcastWorkspacePeers(self.workspaceCode);
          }

          sendWs(target.ws, 'session:accepted', {
            sessionId,
            role: 'host',
            remotePeerId: self.peerId,
            remoteName: self.displayName,
            mode: requestedMode,
            autoApproved: true,
            remoteAgentConnected: target.agentWs !== null && target.agentWs.readyState === WebSocket.OPEN,
          });
          sendWs(self.ws, 'session:accepted', {
            sessionId,
            role: 'viewer',
            remotePeerId: target.peerId,
            remoteName: target.displayName,
            mode: requestedMode,
            autoApproved: true,
            remoteAgentConnected: target.agentWs !== null && target.agentWs.readyState === WebSocket.OPEN,
          });
        } else {
          sendWs(self.ws, 'session:pending', {
            sessionId,
            targetPeerId: target.peerId,
            targetName: target.displayName,
          });
          sendWs(target.ws, 'session:incoming', {
            sessionId,
            fromPeerId: self.peerId,
            fromName: self.displayName,
            requestedMode,
            timestamp: startedAt,
          });
        }
        return;
      }

      if (event === 'session:respond') {
        const sessionId = String(payload.sessionId || '');
        const accepted = Boolean(payload.accepted);
        const grantedMode = (payload.grantedMode as AccessMode) || 'assist';
        const sess = activeSessions.get(sessionId);
        if (!sess || sess.hostPeerId !== self.peerId) return;

        const viewer = peers.get(sess.viewerPeerId);
        if (!viewer) {
          activeSessions.delete(sessionId);
          return;
        }

        if (!accepted) {
          finalizeSession(sessionId, 'declined', 'Connection request declined by host.');
          return;
        }

        sess.accepted = true;
        sess.mode = grantedMode;
        self.status = 'in-session';
        viewer.status = 'in-session';
        broadcastWorkspacePeers(self.workspaceCode);
        if (viewer.workspaceCode !== self.workspaceCode) {
          broadcastWorkspacePeers(viewer.workspaceCode);
        }

        const agentConnected = self.agentWs !== null && self.agentWs.readyState === WebSocket.OPEN;

        sendWs(self.ws, 'session:accepted', {
          sessionId,
          role: 'host',
          remotePeerId: viewer.peerId,
          remoteName: viewer.displayName,
          mode: grantedMode,
          autoApproved: false,
          remoteAgentConnected: agentConnected,
        });
        sendWs(viewer.ws, 'session:accepted', {
          sessionId,
          role: 'viewer',
          remotePeerId: self.peerId,
          remoteName: self.displayName,
          mode: grantedMode,
          autoApproved: false,
          remoteAgentConnected: agentConnected,
        });
        return;
      }

      if (
        event === 'webrtc:offer' ||
        event === 'webrtc:answer' ||
        event === 'webrtc:ice-candidate' ||
        event === 'session:mode-update' ||
        event === 'relay:chat' ||
        event === 'relay:pointer' ||
        event === 'relay:annotation' ||
        event === 'relay:clipboard' ||
        event === 'relay:transport' ||
        event === 'relay:frame' ||
        event === 'relay:file-start' ||
        event === 'relay:file-chunk' ||
        event === 'relay:file-end'
      ) {
        const sessionId = String(payload.sessionId || '');
        const sess = activeSessions.get(sessionId);
        if (!sess) return;
        if (sess.hostPeerId !== self.peerId && sess.viewerPeerId !== self.peerId) return;

        const targetPeerId =
          sess.hostPeerId === self.peerId ? sess.viewerPeerId : sess.hostPeerId;
        const target = peers.get(targetPeerId);
        if (!target) return;

        if (event === 'session:mode-update' && sess.hostPeerId === self.peerId) {
          sess.mode = (payload.mode as AccessMode) || sess.mode;
        }

        // Backpressure check for high-frequency video frames over WS relay
        if (event === 'relay:frame' && target.ws.bufferedAmount > 2 * 1024 * 1024) {
          return;
        }

        sendWs(target.ws, event, {
          ...payload,
          fromPeerId: self.peerId,
        });
        return;
      }

      if (event === 'control:input') {
        const sessionId = String(payload.sessionId || '');
        const sess = activeSessions.get(sessionId);
        if (!sess || sess.viewerPeerId !== self.peerId || !sess.accepted) return;
        if (sess.mode !== 'control' && sess.mode !== 'assist') return;

        const host = peers.get(sess.hostPeerId);
        if (!host) return;

        // Forward to host browser for visual overlay
        sendWs(host.ws, 'control:input', {
          sessionId,
          input: payload.input,
          fromPeerId: self.peerId,
        });

        // Forward to native Companion Agent if mode is 'control' and agent is connected
        if (
          sess.mode === 'control' &&
          host.agentWs &&
          host.agentWs.readyState === WebSocket.OPEN
        ) {
          sendWs(host.agentWs, 'agent:input', payload.input);
        }
        return;
      }

      if (event === 'session:end') {
        const sessionId = String(payload.sessionId || '');
        const sess = activeSessions.get(sessionId);
        if (!sess) return;
        if (sess.hostPeerId !== self.peerId && sess.viewerPeerId !== self.peerId) return;
        finalizeSession(sessionId, 'completed', 'Session ended.');
      }
    });

    ws.on('close', () => {
      if (!currentPeerId) return;
      const peer = peers.get(currentPeerId);
      if (!peer) return;

      for (const [sessId, sess] of activeSessions.entries()) {
        if (sess.hostPeerId === currentPeerId || sess.viewerPeerId === currentPeerId) {
          finalizeSession(sessId, 'completed', `${peer.displayName} disconnected.`);
        }
      }

      if (peer.agentWs && peer.agentWs.readyState === WebSocket.OPEN) {
        peer.agentWs.close(4000, 'Host browser disconnected');
      }

      const room = peer.workspaceCode;
      peers.delete(currentPeerId);
      broadcastWorkspacePeers(room);
    });
  });

  const isProd = process.env.NODE_ENV === 'production' || __filename.endsWith('server.js') || process.env.TEAMDESK_EMBEDDED === '1';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        allowedHosts: true,
        ws: {
          server: httpServer,
          path: '/__vite_ws',
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const embedded = (globalThis as any).__TEAMDESK_ASSETS__ as
      | ((p: string) => { body: Buffer; type: string } | null)
      | undefined;
    if (embedded) {
      app.get('*', (req, res) => {
        const reqPath = decodeURIComponent(req.path);
        const hit = embedded(reqPath) || (path.extname(reqPath) ? null : embedded('/index.html'));
        if (!hit) {
          res.status(404).end();
          return;
        }
        res.setHeader('Content-Type', hit.type);
        if (reqPath.startsWith('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.send(hit.body);
      });
    } else {
      const distPath = path.resolve(__dirname, 'dist');
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  httpServer.listen(PORT, HOST, () => {
    console.log(`TeamDesk signaling & web server listening on http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start TeamDesk server:', err);
  process.exit(1);
});
