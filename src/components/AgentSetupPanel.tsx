import React, { useState } from 'react';
import { Check, Copy, Download, Globe, Laptop, ShieldCheck, Terminal } from 'lucide-react';
import type { CustomTurnConfig, PeerSummary } from '../types/teamdesk';

interface AgentSetupPanelProps {
  selfPeer: PeerSummary | null;
  agentToken: string;
  customTurn: CustomTurnConfig;
  onUpdateTurn: (next: CustomTurnConfig) => void;
  labels: Record<string, string>;
}

export const AgentSetupPanel: React.FC<AgentSetupPanelProps> = ({
  selfPeer,
  agentToken,
  customTurn,
  onUpdateTurn,
  labels,
}) => {
  const [copiedCmd, setCopiedCmd] = useState<'ps' | 'node' | null>(null);
  const [turnEnabled, setTurnEnabled] = useState(customTurn.enabled);
  const [turnUrls, setTurnUrls] = useState(customTurn.urls);
  const [turnUser, setTurnUser] = useState(customTurn.username);
  const [turnPass, setTurnPass] = useState(customTurn.credential);
  const [savedTurn, setSavedTurn] = useState(false);

  const peerId = selfPeer?.peerId || '000-000-000';
  const winDownloadUrl = `/api/agent/download?platform=windows-ps1&peerId=${encodeURIComponent(
    peerId
  )}&token=${encodeURIComponent(agentToken)}`;
  const nodeDownloadUrl = `/api/agent/download?platform=cross-node&peerId=${encodeURIComponent(
    peerId
  )}&token=${encodeURIComponent(agentToken)}`;

  const winCmd = `powershell -ExecutionPolicy Bypass -File .\\teamdesk-agent.ps1`;
  const nodeCmd = `npm install ws @nut-tree-fork/nut-js && node teamdesk-agent.mjs`;

  const copyCommand = (kind: 'ps' | 'node', text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedCmd(kind);
    setTimeout(() => setCopiedCmd(null), 1500);
  };

  const handleSaveTurn = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateTurn({
      enabled: turnEnabled,
      urls: turnUrls,
      username: turnUser,
      credential: turnPass,
    });
    setSavedTurn(true);
    setTimeout(() => setSavedTurn(false), 1800);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-lg font-semibold text-slate-900">{labels.agentTitle}</h2>
            <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">{labels.agentSubtitle}</p>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 bg-slate-50">
            <ShieldCheck
              className={`w-4 h-4 ${
                selfPeer?.hasCompanionAgent ? 'text-emerald-600' : 'text-slate-400'
              }`}
            />
            <span className={selfPeer?.hasCompanionAgent ? 'text-emerald-700' : 'text-slate-600'}>
              {selfPeer?.hasCompanionAgent ? labels.agentConnected : labels.agentDisconnected}
            </span>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
          {labels.browserModeNote}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Windows Native PowerShell Agent */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col justify-between gap-5">
          <div>
            <div className="flex items-center gap-2.5 text-slate-900 font-semibold text-base">
              <Laptop className="w-4 h-4 text-blue-600" />
              <span>Windows 10 / 11 Native Agent</span>
            </div>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              Zero external dependencies. Uses built-in Windows .NET and Win32 mouse/keyboard APIs.
              Pre-configured for your Peer ID{' '}
              <span className="font-mono text-slate-800">{peerId}</span>. Connects outbound over
              HTTPS/WSS port 443 so no router port-forwarding is needed.
            </p>

            <div className="mt-4 rounded-lg bg-slate-900 text-slate-100 p-3 font-mono text-xs flex items-center justify-between gap-2">
              <span className="truncate">{winCmd}</span>
              <button
                onClick={() => copyCommand('ps', winCmd)}
                className="inline-flex items-center gap-1 text-slate-300 hover:text-white shrink-0"
              >
                {copiedCmd === 'ps' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedCmd === 'ps' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          <a
            href={winDownloadUrl}
            download="teamdesk-agent.ps1"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors"
          >
            <Download className="w-4 h-4" />
            {labels.downloadWin}
          </a>
        </div>

        {/* macOS / Linux / Node.js Agent */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col justify-between gap-5">
          <div>
            <div className="flex items-center gap-2.5 text-slate-900 font-semibold text-base">
              <Terminal className="w-4 h-4 text-slate-700" />
              <span>macOS / Linux Cross-Platform Agent</span>
            </div>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              Runs with Node.js 18+ and bridges remote mouse/keyboard events via{' '}
              <span className="font-mono text-slate-800">@nut-tree-fork/nut-js</span>. Grant
              Accessibility permission when prompted on macOS.
            </p>

            <div className="mt-4 rounded-lg bg-slate-900 text-slate-100 p-3 font-mono text-xs flex items-center justify-between gap-2">
              <span className="truncate">{nodeCmd}</span>
              <button
                onClick={() => copyCommand('node', nodeCmd)}
                className="inline-flex items-center gap-1 text-slate-300 hover:text-white shrink-0"
              >
                {copiedCmd === 'node' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedCmd === 'node' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          <a
            href={nodeDownloadUrl}
            download="teamdesk-agent.mjs"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 transition-colors"
          >
            <Download className="w-4 h-4" />
            {labels.downloadNode}
          </a>
        </div>
      </div>

      {/* Optional Custom TURN Relay Settings */}
      <form
        onSubmit={handleSaveTurn}
        className="rounded-xl border border-slate-200 bg-white p-6 space-y-4"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Globe className="w-4 h-4 text-blue-600" />
              <span>{labels.turnSettingsTitle}</span>
            </div>
            <p className="text-xs text-slate-500 mt-1 max-w-2xl">{labels.turnSettingsDesc}</p>
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={turnEnabled}
              onChange={(e) => setTurnEnabled(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
            <span>Enable TURN</span>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              TURN URL(s)
            </label>
            <input
              type="text"
              value={turnUrls}
              onChange={(e) => setTurnUrls(e.target.value)}
              placeholder="turn:relay.example.com:3478, turns:relay.example.com:443?transport=tcp"
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Username</label>
            <input
              type="text"
              value={turnUser}
              onChange={(e) => setTurnUser(e.target.value)}
              placeholder="turn-user"
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Credential</label>
            <input
              type="password"
              value={turnPass}
              onChange={(e) => setTurnPass(e.target.value)}
              placeholder="••••••"
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors"
          >
            {labels.saveTurnBtn}
          </button>
          {savedTurn && (
            <span className="text-xs font-medium text-emerald-600 flex items-center gap-1">
              <Check className="w-3.5 h-3.5" />
              Saved
            </span>
          )}
        </div>
      </form>
    </div>
  );
};
