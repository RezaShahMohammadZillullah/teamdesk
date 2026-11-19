import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BookmarkPlus,
  Check,
  Copy,
  Link2,
  Monitor,
  PhoneIncoming,
  Search,
  Trash2,
  UserCheck,
  Users,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useTeamDesk } from './hooks/useTeamDesk';
import { translations, type Lang } from './i18n/translations';
import { RemoteViewport } from './components/RemoteViewport';
import { FileClipboardPanel } from './components/FileClipboardPanel';
import { AgentSetupPanel } from './components/AgentSetupPanel';
import type { AccessMode, PeerStatus } from './types/teamdesk';

type NavTab = 'connect' | 'directory' | 'files' | 'history' | 'agent';

function formatDuration(sec?: number): string {
  if (typeof sec !== 'number') return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function App() {
  const {
    identity,
    updateIdentity,
    customTurn,
    updateCustomTurn,
    wsConnected,
    selfPeer,
    agentToken,
    directoryPeers,
    contacts,
    sessionHistory,
    pendingOutgoing,
    incomingRequest,
    activeSession,
    errorMessage,
    setErrorMessage,
    localStream,
    remoteStream,
    relayedFrame,
    micEnabled,
    chatMessages,
    fileTransfers,
    sharedClipboard,
    annotations,
    remotePointer,
    telemetry,
    setAvailability,
    startScreenShare,
    stopScreenShare,
    toggleMicrophone,
    requestSession,
    respondToIncoming,
    endActiveSession,
    updateSessionMode,
    switchTransportMode,
    sendChatMessage,
    sendClipboard,
    sendPointer,
    sendAnnotationStroke,
    clearAnnotations,
    sendRemoteInput,
    sendFile,
    saveContact,
    removeContact,
  } = useTeamDesk();

  const [lang, setLang] = useState<Lang>('en');
  const t = translations[lang];

  const [activeTab, setActiveTab] = useState<NavTab>('connect');
  const [targetPeerInput, setTargetPeerInput] = useState('');
  const [targetPinInput, setTargetPinInput] = useState('');
  const [requestedMode, setRequestedMode] = useState<AccessMode>('control');

  const [nameDraft, setNameDraft] = useState(identity.displayName);
  const [roleDraft, setRoleDraft] = useState(identity.roleTitle);
  const [pinDraft, setPinDraft] = useState(identity.pinCode);
  const [unattendedDraft, setUnattendedDraft] = useState(identity.unattendedEnabled);
  const [roomDraft, setRoomDraft] = useState(identity.workspaceCode);
  const [profileSavedToast, setProfileSavedToast] = useState(false);

  const [copiedState, setCopiedState] = useState<'id' | 'link' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [historyFilter, setHistoryFilter] = useState<'all' | 'completed' | 'declined'>('all');

  const [newContactId, setNewContactId] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [newContactRole, setNewContactRole] = useState('');
  const [showAddContact, setShowAddContact] = useState(false);

  // Sync URL query invite (?connect=XXX-XXX-XXX&room=CODE)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connectParam = params.get('connect');
    const roomParam = params.get('room');
    if (connectParam) {
      setTargetPeerInput(connectParam);
    }
    if (roomParam && roomParam.trim() && roomParam.toUpperCase() !== identity.workspaceCode) {
      const normalizedRoom = roomParam.trim().toUpperCase();
      setRoomDraft(normalizedRoom);
      updateIdentity({ workspaceCode: normalizedRoom });
    }
  }, []);

  const onlineTeammates = useMemo(() => {
    return directoryPeers.filter((p) => p.peerId !== selfPeer?.peerId);
  }, [directoryPeers, selfPeer?.peerId]);

  const filteredOnline = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return onlineTeammates;
    return onlineTeammates.filter(
      (p) =>
        p.displayName.toLowerCase().includes(q) ||
        p.roleTitle.toLowerCase().includes(q) ||
        p.peerId.toLowerCase().includes(q)
    );
  }, [onlineTeammates, searchQuery]);

  const filteredContacts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        c.roleTitle.toLowerCase().includes(q) ||
        c.peerId.toLowerCase().includes(q)
    );
  }, [contacts, searchQuery]);

  const filteredHistory = useMemo(() => {
    if (historyFilter === 'all') return sessionHistory;
    return sessionHistory.filter((s) => s.status === historyFilter);
  }, [historyFilter, sessionHistory]);

  const copyId = () => {
    if (!selfPeer) return;
    navigator.clipboard.writeText(selfPeer.peerId).catch(() => {});
    setCopiedState('id');
    setTimeout(() => setCopiedState(null), 1500);
  };

  const copyInviteLink = () => {
    if (!selfPeer) return;
    const url = `${window.location.origin}/?connect=${encodeURIComponent(
      selfPeer.peerId
    )}&room=${encodeURIComponent(selfPeer.workspaceCode)}`;
    navigator.clipboard.writeText(url).catch(() => {});
    setCopiedState('link');
    setTimeout(() => setCopiedState(null), 1500);
  };

  const handleSaveIdentity = (e: React.FormEvent) => {
    e.preventDefault();
    updateIdentity({
      displayName: nameDraft.trim() || 'Team Member',
      roleTitle: roleDraft.trim() || 'Member',
      pinCode: pinDraft.trim(),
      unattendedEnabled: unattendedDraft,
    });
    setProfileSavedToast(true);
    setTimeout(() => setProfileSavedToast(false), 1800);
  };

  const handleRoomSwitch = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = roomDraft.trim().toUpperCase() || 'TEAM-CORE';
    setRoomDraft(cleaned);
    updateIdentity({ workspaceCode: cleaned });
  };

  const handleConnectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetPeerInput.trim()) return;
    requestSession(targetPeerInput.trim(), requestedMode, targetPinInput.trim());
  };

  const handleAddManualContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContactId.trim() || !newContactName.trim()) return;
    await saveContact({
      peerId: newContactId.trim(),
      displayName: newContactName.trim(),
      roleTitle: newContactRole.trim() || 'Team Member',
      workspaceCode: identity.workspaceCode,
    });
    setNewContactId('');
    setNewContactName('');
    setNewContactRole('');
    setShowAddContact(false);
  };

  const onlinePeerIds = useMemo(
    () => new Set(directoryPeers.map((p) => p.peerId)),
    [directoryPeers]
  );

  const handlePrimaryHeaderAction = () => {
    if (activeSession) {
      endActiveSession();
    } else if (localStream) {
      stopScreenShare();
    } else {
      startScreenShare();
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="bg-white border-b border-slate-200 px-6 py-3.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-8">
          <a
            href="#connect"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('connect');
            }}
            className="text-lg font-display font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            {t.brand}
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            {(
              [
                ['connect', t.navConnect],
                ['directory', t.navDirectory],
                ['files', t.navFiles],
                ['history', t.navHistory],
                ['agent', t.navAgent],
              ] as Array<[NavTab, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === key
                    ? 'border-blue-600 text-slate-900'
                    : 'border-transparent hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="flex items-center shrink-0">
            <button
              onClick={handlePrimaryHeaderAction}
              className={`px-4 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                activeSession
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : localStream
                  ? 'bg-slate-900 text-white hover:bg-slate-800'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {activeSession
                ? t.endSession
                : localStream
                ? t.stopSharing
                : t.shareScreen}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Navigation */}
      <div className="md:hidden bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-2 overflow-x-auto">
        {(
          [
            ['connect', t.navConnect],
            ['directory', t.navDirectory],
            ['files', t.navFiles],
            ['history', t.navHistory],
            ['agent', t.navAgent],
          ] as Array<[NavTab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              activeTab === key ? 'bg-slate-900 text-white' : 'text-slate-600 bg-slate-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Workspace Toolbar (below Top Bar) */}
      <div className="bg-white border-b border-slate-200 px-6 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <form onSubmit={handleRoomSwitch} className="flex items-center gap-2">
              <span className="text-slate-500 font-medium">{t.workspaceLabel}:</span>
              <input
                type="text"
                value={roomDraft}
                onChange={(e) => setRoomDraft(e.target.value.toUpperCase())}
                className="w-28 px-2.5 py-1 font-mono text-xs rounded-md border border-slate-200 bg-slate-50 text-slate-900 focus:outline-none focus:border-blue-600"
              />
              <button
                type="submit"
                className="px-2.5 py-1 font-medium rounded-md border border-slate-200 text-slate-700 hover:bg-slate-100 transition-colors whitespace-nowrap"
              >
                {t.changeRoom}
              </button>
            </form>

            <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
              |
            </span>

            <div className="flex items-center gap-2 text-slate-600">
              {wsConnected ? (
                <Wifi className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <WifiOff className="w-3.5 h-3.5 text-amber-600" />
              )}
              <span>{wsConnected ? t.wsConnected : t.wsDisconnected}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{directoryPeers.length} online</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-md">
              {(['available', 'busy'] as PeerStatus[]).map((st) => (
                <button
                  key={st}
                  onClick={() => setAvailability(st)}
                  disabled={selfPeer?.status === 'in-session'}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                    selfPeer?.status === st
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {st === 'available' ? t.statusAvailable : t.statusBusy}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-md">
              <button
                onClick={() => setLang('en')}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  lang === 'en' ? 'bg-white text-slate-900' : 'text-slate-600'
                }`}
              >
                EN
              </button>
              <button
                onClick={() => setLang('bn')}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  lang === 'bn' ? 'bg-white text-slate-900' : 'text-slate-600'
                }`}
              >
                বাংলা
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6 space-y-6">
        {errorMessage && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-red-200 bg-red-50 text-red-800 text-xs">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-red-700 hover:text-red-900"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Active Remote Desktop Session Theatre */}
        {activeSession && activeTab === 'connect' && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            <div className="xl:col-span-8">
              <RemoteViewport
                session={activeSession}
                selfPeerId={selfPeer?.peerId || ''}
                localStream={localStream}
                remoteStream={remoteStream}
                relayedFrame={relayedFrame}
                micEnabled={micEnabled}
                annotations={annotations}
                remotePointer={remotePointer}
                telemetry={telemetry}
                labels={t}
                onStartShare={startScreenShare}
                onToggleMic={toggleMicrophone}
                onEndSession={endActiveSession}
                onUpdateMode={updateSessionMode}
                onSwitchTransport={switchTransportMode}
                onSendPointer={sendPointer}
                onAddAnnotation={sendAnnotationStroke}
                onClearAnnotations={clearAnnotations}
                onSendRemoteInput={sendRemoteInput}
              />
            </div>
            <div className="xl:col-span-4">
              <FileClipboardPanel
                compact
                activeSession={activeSession}
                chatMessages={chatMessages}
                fileTransfers={fileTransfers}
                sharedClipboard={sharedClipboard}
                selfPeerId={selfPeer?.peerId || ''}
                labels={t}
                onSendChat={sendChatMessage}
                onSendFile={sendFile}
                onSendClipboard={sendClipboard}
              />
            </div>
          </div>
        )}

        {/* CONNECT TAB (when no active session or below) */}
        {activeTab === 'connect' && !activeSession && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              {/* Left: This Computer / Peer Identity */}
              <section className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6 flex flex-col justify-between gap-6">
                <div>
                  <h1 className="text-xl font-semibold text-slate-900 text-balance">
                    {t.myDeskTitle}
                  </h1>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">{t.myDeskSubtitle}</p>

                  <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-medium text-slate-500">{t.yourPeerId}</div>
                    <div className="mt-1 flex items-center justify-between gap-3">
                      <span className="text-2xl sm:text-3xl font-mono font-semibold tracking-tight text-slate-900 tabular-nums">
                        {selfPeer?.peerId || '--- --- ---'}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={copyId}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 transition-colors whitespace-nowrap"
                        >
                          {copiedState === 'id' ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          {copiedState === 'id' ? t.copied : t.copyId}
                        </button>
                        <button
                          onClick={copyInviteLink}
                          title={t.copyInvite}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 transition-colors whitespace-nowrap"
                        >
                          {copiedState === 'link' ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Link2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  <form onSubmit={handleSaveIdentity} className="mt-5 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          {t.displayName}
                        </label>
                        <input
                          type="text"
                          value={nameDraft}
                          onChange={(e) => setNameDraft(e.target.value)}
                          className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          {t.roleTitle}
                        </label>
                        <input
                          type="text"
                          value={roleDraft}
                          onChange={(e) => setRoleDraft(e.target.value)}
                          className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                        />
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100">
                      <label className="flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={unattendedDraft}
                          onChange={(e) => setUnattendedDraft(e.target.checked)}
                          className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                        />
                        <div>
                          <div className="text-xs font-medium text-slate-900">
                            {t.unattendedAccess}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {t.unattendedDesc}
                          </div>
                        </div>
                      </label>

                      {unattendedDraft && (
                        <div className="mt-3">
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            {t.securityPin}
                          </label>
                          <input
                            type="password"
                            maxLength={8}
                            value={pinDraft}
                            onChange={(e) => setPinDraft(e.target.value)}
                            placeholder="e.g. 482910"
                            className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                          />
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="submit"
                        className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors"
                      >
                        {t.saveProfile}
                      </button>
                      {profileSavedToast && (
                        <span className="text-xs font-medium text-emerald-600 flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" />
                          Saved
                        </span>
                      )}
                    </div>
                  </form>
                </div>
              </section>

              {/* Right: Connect to Remote Teammate */}
              <section className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6 flex flex-col justify-between gap-6">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900 text-balance">
                    {t.connectTitle}
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">{t.connectSubtitle}</p>

                  <form onSubmit={handleConnectSubmit} className="mt-5 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                      <div className="sm:col-span-7">
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          {t.remotePeerId}
                        </label>
                        <input
                          type="text"
                          value={targetPeerInput}
                          onChange={(e) => setTargetPeerInput(e.target.value)}
                          placeholder="482-910-334"
                          className="w-full px-3.5 py-2.5 text-sm font-mono rounded-lg border border-slate-200 bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                        />
                      </div>
                      <div className="sm:col-span-5">
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          {t.optionalPin}
                        </label>
                        <input
                          type="password"
                          value={targetPinInput}
                          onChange={(e) => setTargetPinInput(e.target.value)}
                          placeholder="••••••"
                          className="w-full px-3.5 py-2.5 text-sm font-mono rounded-lg border border-slate-200 bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">
                        {t.accessMode}
                      </label>
                      <div className="grid grid-cols-3 gap-2 p-1 bg-slate-100 rounded-lg">
                        {(
                          [
                            ['view', t.modeView],
                            ['assist', t.modeAssist],
                            ['control', t.modeControl],
                          ] as Array<[AccessMode, string]>
                        ).map(([mode, label]) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setRequestedMode(mode)}
                            className={`px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                              requestedMode === mode
                                ? 'bg-white text-slate-900 shadow-xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      <button
                        type="submit"
                        disabled={!targetPeerInput.trim() || Boolean(pendingOutgoing)}
                        className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 whitespace-nowrap"
                      >
                        <span>
                          {pendingOutgoing
                            ? `${t.connecting} (${pendingOutgoing.targetName})`
                            : t.connectBtn}
                        </span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>

                      {localStream && (
                        <span className="text-xs text-emerald-700 font-medium flex items-center gap-1.5">
                          <Monitor className="w-3.5 h-3.5" />
                          Your screen stream is ready for incoming connections
                        </span>
                      )}
                    </div>
                  </form>
                </div>

                {/* Live Online Teammates Quick Connect */}
                <div className="pt-5 border-t border-slate-100">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                      <Users className="w-4 h-4 text-slate-500" />
                      <span>
                        {t.onlineTeamTitle} ({onlineTeammates.length})
                      </span>
                    </div>
                    <button
                      onClick={() => setActiveTab('directory')}
                      className="text-xs font-medium text-blue-600 hover:text-blue-700"
                    >
                      {t.navDirectory}
                    </button>
                  </div>

                  {onlineTeammates.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-xs text-slate-500">
                      {t.onlineTeamEmpty}
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                      {onlineTeammates.slice(0, 6).map((peer) => (
                        <div
                          key={peer.peerId}
                          className="flex items-center justify-between gap-3 px-4 py-2.5 bg-white hover:bg-slate-50 transition-colors"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-900 truncate">
                              {peer.displayName}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono tabular-nums truncate">
                              {peer.peerId} · {peer.roleTitle} · {peer.osPlatform}
                              {peer.hasCompanionAgent ? ' · OS Agent Ready' : ''}
                            </div>
                          </div>

                          <button
                            disabled={peer.status === 'busy'}
                            onClick={() =>
                              requestSession(peer.peerId, requestedMode, targetPinInput.trim())
                            }
                            className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0"
                          >
                            {peer.status === 'busy' ? t.statusBusy : t.connectQuick}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        )}

        {/* TEAM DIRECTORY TAB */}
        {activeTab === 'directory' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="relative flex-1 min-w-[260px] max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t.searchPlaceholder}
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>

              <button
                onClick={() => setShowAddContact((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 whitespace-nowrap"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                {t.addContact}
              </button>
            </div>

            {showAddContact && (
              <form
                onSubmit={handleAddManualContact}
                className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
              >
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {t.remotePeerId}
                  </label>
                  <input
                    type="text"
                    required
                    value={newContactId}
                    onChange={(e) => setNewContactId(e.target.value)}
                    placeholder="482-910-334"
                    className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {t.displayName}
                  </label>
                  <input
                    type="text"
                    required
                    value={newContactName}
                    onChange={(e) => setNewContactName(e.target.value)}
                    placeholder="e.g. Tariq Hasan"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {t.roleTitle}
                  </label>
                  <input
                    type="text"
                    value={newContactRole}
                    onChange={(e) => setNewContactRole(e.target.value)}
                    placeholder="e.g. Designer"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                >
                  Save Contact
                </button>
              </form>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Online Peers */}
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-900">
                    {t.onlineTeamTitle} ({filteredOnline.length})
                  </h2>
                  <span className="text-xs font-mono text-slate-500">
                    {identity.workspaceCode}
                  </span>
                </div>

                {filteredOnline.length === 0 ? (
                  <div className="p-6 text-xs text-slate-500">{t.onlineTeamEmpty}</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {filteredOnline.map((peer) => (
                      <div
                        key={peer.peerId}
                        className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50 transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900 truncate">
                            {peer.displayName}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono tabular-nums truncate">
                            {peer.peerId} · {peer.roleTitle} · {peer.osPlatform} ·{' '}
                            {peer.status === 'busy'
                              ? t.statusBusy
                              : peer.status === 'in-session'
                              ? t.statusInSession
                              : t.statusAvailable}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() =>
                              saveContact({
                                peerId: peer.peerId,
                                displayName: peer.displayName,
                                roleTitle: peer.roleTitle,
                                workspaceCode: peer.workspaceCode,
                              })
                            }
                            className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 text-slate-700 hover:bg-slate-100"
                          >
                            {t.saveContact}
                          </button>
                          <button
                            disabled={peer.status === 'busy'}
                            onClick={() => {
                              setActiveTab('connect');
                              requestSession(peer.peerId, requestedMode);
                            }}
                            className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
                          >
                            {t.connectQuick}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Saved Address Book */}
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-900">
                    {t.savedContactsTitle} ({filteredContacts.length})
                  </h2>
                </div>

                {filteredContacts.length === 0 ? (
                  <div className="p-6 text-xs text-slate-500">{t.savedContactsEmpty}</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {filteredContacts.map((c) => {
                      const isOnline = onlinePeerIds.has(c.peerId);
                      return (
                        <div
                          key={c.peerId}
                          className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50 transition-colors"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-900 truncate">
                              {c.displayName}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono tabular-nums truncate">
                              {c.peerId} · {c.roleTitle} ·{' '}
                              <span className={isOnline ? 'text-emerald-700' : 'text-slate-400'}>
                                {isOnline ? 'Online' : 'Offline'}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              disabled={!isOnline}
                              onClick={() => {
                                setActiveTab('connect');
                                requestSession(c.peerId, requestedMode);
                              }}
                              className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40"
                            >
                              {t.connectQuick}
                            </button>
                            <button
                              aria-label="Delete contact"
                              onClick={() => removeContact(c.peerId)}
                              className="p-1.5 text-slate-400 hover:text-red-600 rounded-md"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* FILES & CHAT TAB */}
        {activeTab === 'files' && (
          <FileClipboardPanel
            activeSession={activeSession}
            chatMessages={chatMessages}
            fileTransfers={fileTransfers}
            sharedClipboard={sharedClipboard}
            selfPeerId={selfPeer?.peerId || ''}
            labels={t}
            onSendChat={sendChatMessage}
            onSendFile={sendFile}
            onSendClipboard={sendClipboard}
          />
        )}

        {/* SESSION LOG TAB */}
        {activeTab === 'history' && (
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{t.sessionLogTitle}</h2>
                <p className="text-xs text-slate-500 mt-0.5">{t.sessionLogSubtitle}</p>
              </div>
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                {(['all', 'completed', 'declined'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setHistoryFilter(f)}
                    className={`px-3 py-1 text-xs font-medium rounded-md capitalize transition-colors ${
                      historyFilter === f
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {filteredHistory.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">{t.sessionLogEmpty}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500">
                      <th className="py-2.5 px-6">{t.colTime}</th>
                      <th className="py-2.5 px-4">{t.colHost}</th>
                      <th className="py-2.5 px-4">{t.colViewer}</th>
                      <th className="py-2.5 px-4">{t.colMode}</th>
                      <th className="py-2.5 px-4 text-right">{t.colDuration}</th>
                      <th className="py-2.5 px-6 text-right">{t.colStatus}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {filteredHistory.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50 transition-colors h-10">
                        <td className="py-2 px-6 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          {new Date(row.startedAt).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="py-2 px-4 text-slate-900 font-medium">
                          {row.hostName}{' '}
                          <span className="font-mono text-slate-400 tabular-nums">
                            ({row.hostPeerId})
                          </span>
                        </td>
                        <td className="py-2 px-4 text-slate-700">
                          {row.viewerName}{' '}
                          <span className="font-mono text-slate-400 tabular-nums">
                            ({row.viewerPeerId})
                          </span>
                        </td>
                        <td className="py-2 px-4 capitalize text-slate-600">{row.mode}</td>
                        <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-600">
                          {formatDuration(row.durationSeconds)}
                        </td>
                        <td
                          className={`py-2 px-6 text-right font-medium capitalize ${
                            row.status === 'completed' || row.status === 'active'
                              ? 'text-emerald-700'
                              : row.status === 'declined'
                              ? 'text-amber-700'
                              : 'text-red-700'
                          }`}
                        >
                          {row.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* DESKTOP AGENT TAB */}
        {activeTab === 'agent' && (
          <AgentSetupPanel
            selfPeer={selfPeer}
            agentToken={agentToken}
            customTurn={customTurn}
            onUpdateTurn={updateCustomTurn}
            labels={t}
          />
        )}
      </main>

      {/* Incoming Connection Request Modal */}
      {incomingRequest && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-lg bg-blue-50 text-blue-600 shrink-0">
                <PhoneIncoming className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-slate-900">{t.incomingTitle}</h3>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  <span className="font-semibold text-slate-900">
                    {incomingRequest.fromName}
                  </span>{' '}
                  (<span className="font-mono tabular-nums">{incomingRequest.fromPeerId}</span>){' '}
                  {t.incomingBody}
                </p>
                <div className="mt-2 text-xs text-slate-500">
                  Requested permission:{' '}
                  <span className="font-medium text-slate-800 capitalize">
                    {incomingRequest.requestedMode}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
              <button
                onClick={() => respondToIncoming(false, 'view')}
                className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100"
              >
                {t.decline}
              </button>
              <button
                onClick={() => {
                  setActiveTab('connect');
                  respondToIncoming(true, 'assist');
                }}
                className="px-3.5 py-2 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800"
              >
                {t.acceptAssist}
              </button>
              <button
                onClick={() => {
                  setActiveTab('connect');
                  respondToIncoming(true, 'control');
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700"
              >
                <UserCheck className="w-3.5 h-3.5" />
                {t.acceptControl}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
