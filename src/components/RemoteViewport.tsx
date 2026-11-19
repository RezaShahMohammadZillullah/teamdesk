import React, { useEffect, useRef, useState } from 'react';
import {
  Eraser,
  Globe,
  Keyboard,
  Maximize2,
  Mic,
  MicOff,
  Monitor,
  MousePointer2,
  PenTool,
  PhoneOff,
  Radio,
  Shield,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  AccessMode,
  ActiveSessionState,
  AnnotationStroke,
  RemoteInputEvent,
  RemotePointer,
  TransportMode,
} from '../types/teamdesk';
import type { RelayedFrame, StreamTelemetry } from '../hooks/useTeamDesk';

interface RemoteViewportProps {
  session: ActiveSessionState;
  selfPeerId: string;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  relayedFrame: RelayedFrame | null;
  micEnabled: boolean;
  annotations: AnnotationStroke[];
  remotePointer: RemotePointer | null;
  telemetry: StreamTelemetry | null;
  labels: Record<string, string>;
  onStartShare: () => Promise<MediaStream | null>;
  onToggleMic: () => Promise<void>;
  onEndSession: () => void;
  onUpdateMode: (mode: AccessMode) => void;
  onSwitchTransport: (mode: TransportMode) => void;
  onSendPointer: (x: number, y: number, activeClick?: boolean) => void;
  onAddAnnotation: (stroke: AnnotationStroke) => void;
  onClearAnnotations: () => void;
  onSendRemoteInput: (input: RemoteInputEvent) => void;
}

type ToolMode = 'pointer' | 'annotate' | 'control';

const INK_COLORS = ['#2563EB', '#DC2626', '#D97706', '#16A34A'];

export const RemoteViewport: React.FC<RemoteViewportProps> = ({
  session,
  selfPeerId,
  localStream,
  remoteStream,
  relayedFrame,
  micEnabled,
  annotations,
  remotePointer,
  telemetry,
  labels,
  onStartShare,
  onToggleMic,
  onEndSession,
  onUpdateMode,
  onSwitchTransport,
  onSendPointer,
  onAddAnnotation,
  onClearAnnotations,
  onSendRemoteInput,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);

  const [tool, setTool] = useState<ToolMode>(
    session.mode === 'control' ? 'control' : 'pointer'
  );
  const [inkColor, setInkColor] = useState<string>(INK_COLORS[0]);
  const [muted, setMuted] = useState<boolean>(session.role === 'host');
  const [fitMode, setFitMode] = useState<'contain' | 'actual'>('contain');
  const [keyboardCaptured, setKeyboardCaptured] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [draftPoints, setDraftPoints] = useState<Array<{ x: number; y: number }> | null>(null);

  const activeStream = session.role === 'host' ? localStream : remoteStream;
  const usingRelayedFrames =
    session.role === 'viewer' &&
    (session.transportMode === 'wss-relay' || (!remoteStream && Boolean(relayedFrame)));

  useEffect(() => {
    if (session.mode === 'view' && tool === 'control') {
      setTool('pointer');
      setKeyboardCaptured(false);
    }
  }, [session.mode, tool]);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    if (activeStream && !usingRelayedFrames) {
      videoEl.srcObject = activeStream;
      videoEl.play().catch(() => {
        // Autoplay might wait for user interaction if unmuted
      });
    } else {
      videoEl.srcObject = null;
    }
  }, [activeStream, usingRelayedFrames]);

  useEffect(() => {
    if (!keyboardCaptured || session.role !== 'viewer' || session.mode !== 'control') {
      return;
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && e.shiftKey) {
        setKeyboardCaptured(false);
        return;
      }
      e.preventDefault();
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        onSendRemoteInput({ kind: 'type_text', text: e.key });
      } else {
        onSendRemoteInput({ kind: 'key_tap', key: e.key });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keyboardCaptured, onSendRemoteInput, session.mode, session.role]);

  const getNormalizedCoords = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return { x, y };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (session.role !== 'viewer' || session.mode === 'view') return;
    const { x, y } = getNormalizedCoords(e);

    if (tool === 'annotate') {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDraftPoints([{ x, y }]);
      return;
    }

    if (tool === 'control' && session.mode === 'control') {
      if (e.button === 2) {
        onSendRemoteInput({ kind: 'mouse_rightclick', xNorm: x, yNorm: y });
      } else {
        onSendRemoteInput({ kind: 'mouse_click', xNorm: x, yNorm: y });
      }
      onSendPointer(x, y, true);
      return;
    }

    onSendPointer(x, y, true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (session.role !== 'viewer' || session.mode === 'view') return;
    const { x, y } = getNormalizedCoords(e);

    if (tool === 'annotate' && draftPoints) {
      setDraftPoints((prev) => (prev ? [...prev, { x, y }] : [{ x, y }]));
      return;
    }

    if (tool === 'control' && session.mode === 'control') {
      onSendRemoteInput({ kind: 'mouse_move', xNorm: x, yNorm: y });
    }
    onSendPointer(x, y, false);
  };

  const handlePointerUp = () => {
    if (tool === 'annotate' && draftPoints && draftPoints.length > 1) {
      onAddAnnotation({
        id: crypto.randomUUID(),
        authorPeerId: selfPeerId,
        color: inkColor,
        points: draftPoints,
        createdAt: Date.now(),
      });
    }
    setDraftPoints(null);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (session.role !== 'viewer' || session.mode !== 'control' || tool !== 'control') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    onSendRemoteInput({ kind: 'mouse_dblclick', xNorm: x, yNorm: y });
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (session.role !== 'viewer' || session.mode !== 'control' || tool !== 'control') return;
    onSendRemoteInput({ kind: 'mouse_scroll', deltaY: e.deltaY });
  };

  const toggleRecording = () => {
    if (isRecording && recorderRef.current) {
      recorderRef.current.stop();
      setIsRecording(false);
      return;
    }
    if (!activeStream) return;
    try {
      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(activeStream);
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `teamdesk-session-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`;
        a.click();
        URL.revokeObjectURL(url);
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      setIsRecording(true);
    } catch {
      setIsRecording(false);
    }
  };

  const toggleFullscreen = () => {
    if (!stageRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      stageRef.current.requestFullscreen().catch(() => {});
    }
  };

  const toSvgPath = (pts: Array<{ x: number; y: number }>) =>
    pts
      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${(p.x * 100).toFixed(2)} ${(p.y * 100).toFixed(2)}`)
      .join(' ');

  const transportLabel =
    session.transportMode === 'wss-relay'
      ? labels.transportWssRelay
      : session.transportMode === 'turn'
      ? labels.transportTurn
      : session.transportMode === 'p2p'
      ? labels.transportP2P
      : labels.transportConnecting;

  const hasVisualFeed =
    session.role === 'host'
      ? Boolean(localStream)
      : usingRelayedFrames
      ? Boolean(relayedFrame)
      : Boolean(remoteStream);

  return (
    <div
      ref={stageRef}
      className="flex flex-col rounded-xl border border-slate-200 bg-slate-950 text-slate-100 overflow-hidden"
    >
      {/* Session Control Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-slate-900 border-b border-slate-800">
        <div className="flex items-center gap-3 min-w-0">
          <Monitor className="w-4 h-4 text-blue-400 shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-white truncate">
              <span className="truncate">{session.remoteName}</span>
              <span aria-hidden="true" className="text-slate-500">·</span>
              <span className="font-mono text-xs text-slate-300 tabular-nums">
                {session.remotePeerId}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400 tabular-nums">
              <span>{session.role === 'host' ? 'Hosting' : 'Viewing'}</span>
              <span aria-hidden="true">·</span>
              <span
                className={
                  session.transportMode === 'wss-relay' ? 'text-amber-300' : 'text-emerald-300'
                }
              >
                {transportLabel}
              </span>
              {telemetry && telemetry.width > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">
                    {telemetry.width}×{telemetry.height} · {telemetry.fps} FPS
                    {telemetry.rttMs !== null ? ` · ${telemetry.rttMs} ms` : ''}
                    {telemetry.kbps > 0 ? ` · ${telemetry.kbps} kbps` : ''}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Center / Right Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {session.role === 'host' && (
            <div className="flex items-center gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700">
              <Shield className="w-3.5 h-3.5 text-slate-400 ml-1.5 mr-1" />
              {(['view', 'assist', 'control'] as AccessMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => onUpdateMode(m)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    session.mode === m
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {m === 'view' ? 'View' : m === 'assist' ? 'Assist' : 'Control'}
                </button>
              ))}
            </div>
          )}

          {session.role === 'viewer' && session.mode !== 'view' && (
            <div className="flex items-center gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700">
              <button
                onClick={() => {
                  setTool('pointer');
                  setKeyboardCaptured(false);
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  tool === 'pointer' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                <MousePointer2 className="w-3.5 h-3.5" />
                {labels.pointerMode}
              </button>
              <button
                onClick={() => {
                  setTool('annotate');
                  setKeyboardCaptured(false);
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  tool === 'annotate' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                <PenTool className="w-3.5 h-3.5" />
                {labels.annotateMode}
              </button>
              {session.mode === 'control' && (
                <button
                  onClick={() => setTool('control')}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    tool === 'control'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Monitor className="w-3.5 h-3.5" />
                  {labels.controlMode}
                </button>
              )}
            </div>
          )}

          {tool === 'annotate' && (
            <div className="flex items-center gap-1.5 bg-slate-800 px-2 py-1 rounded-lg border border-slate-700">
              {INK_COLORS.map((c) => (
                <button
                  key={c}
                  aria-label={`Select color ${c}`}
                  onClick={() => setInkColor(c)}
                  className={`w-4 h-4 rounded-full border ${
                    inkColor === c ? 'border-white scale-110' : 'border-transparent opacity-70'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          )}

          {annotations.length > 0 && (
            <button
              onClick={onClearAnnotations}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors whitespace-nowrap"
            >
              <Eraser className="w-3.5 h-3.5" />
              {labels.clearDrawings}
            </button>
          )}

          {session.role === 'viewer' && session.mode === 'control' && tool === 'control' && (
            <button
              onClick={() => setKeyboardCaptured((v) => !v)}
              title="Press Shift+Esc anytime to release keyboard capture"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                keyboardCaptured
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              <Keyboard className="w-3.5 h-3.5" />
              {keyboardCaptured ? labels.captureKeyboard : labels.enableKeyboard}
            </button>
          )}

          <button
            onClick={() =>
              onSwitchTransport(
                session.transportMode === 'wss-relay' ? 'p2p' : 'wss-relay'
              )
            }
            title="Switch between Direct P2P and HTTPS/WSS Firewall Relay"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              session.transportMode === 'wss-relay'
                ? 'bg-amber-600 text-white hover:bg-amber-700'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            {session.transportMode === 'wss-relay'
              ? labels.directP2PBtn
              : labels.firewallRelayBtn}
          </button>

          {session.role === 'host' && (
            <button
              onClick={onStartShare}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 text-slate-100 hover:bg-slate-700 transition-colors whitespace-nowrap"
            >
              <Monitor className="w-3.5 h-3.5" />
              {localStream ? 'Switch Screen' : labels.shareScreen}
            </button>
          )}

          <button
            onClick={onToggleMic}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              micEnabled
                ? 'bg-emerald-700 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {micEnabled ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={() => setMuted((m) => !m)}
            aria-label="Toggle remote audio"
            className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
          >
            {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={() => setFitMode((m) => (m === 'contain' ? 'actual' : 'contain'))}
            className="px-2.5 py-1.5 text-xs font-mono font-medium rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors whitespace-nowrap"
          >
            {fitMode === 'contain' ? labels.fitScreen : labels.actualSize}
          </button>

          {activeStream && !usingRelayedFrames && (
            <button
              onClick={toggleRecording}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                isRecording
                  ? 'bg-red-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              {isRecording ? labels.stopRecord : labels.recordSession}
            </button>
          )}

          <button
            onClick={toggleFullscreen}
            aria-label={labels.fullscreen}
            className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onEndSession}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors whitespace-nowrap"
          >
            <PhoneOff className="w-3.5 h-3.5" />
            {labels.endSession}
          </button>
        </div>
      </div>

      {/* Control Agent Advisory Banner when OS Control active */}
      {session.role === 'viewer' && session.mode === 'control' && !session.remoteAgentConnected && (
        <div className="px-4 py-2 bg-amber-950/60 border-b border-amber-900/60 text-xs text-amber-200 flex items-center justify-between gap-4">
          <span>
            Host’s Local Desktop Agent is not connected — mouse clicks show on screen as a live pointer, while full OS mouse/keyboard execution requires the host to run the Desktop Agent.
          </span>
        </div>
      )}

      {/* Video / Relayed Frame & Interactive Overlay Stage */}
      <div
        className={`relative w-full bg-slate-950 ${
          fitMode === 'actual' ? 'overflow-auto max-h-[72vh]' : 'aspect-video max-h-[72vh]'
        } flex items-center justify-center`}
      >
        {hasVisualFeed ? (
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onDoubleClick={handleDoubleClick}
            onWheel={handleWheel}
            onContextMenu={(e) => {
              if (session.role === 'viewer' && tool === 'control') e.preventDefault();
            }}
            className={`relative ${
              fitMode === 'actual' ? 'w-max h-max' : 'w-full h-full'
            } flex items-center justify-center select-none ${
              session.role === 'viewer' && session.mode !== 'view'
                ? tool === 'annotate'
                  ? 'cursor-crosshair'
                  : 'cursor-pointer'
                : 'cursor-default'
            }`}
          >
            {usingRelayedFrames && relayedFrame ? (
              <img
                src={relayedFrame.dataUrl}
                alt="Relayed remote screen"
                referrerPolicy="no-referrer"
                className={
                  fitMode === 'actual'
                    ? 'max-w-none select-none pointer-events-none'
                    : 'w-full h-full object-contain pointer-events-none select-none'
                }
              />
            ) : (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={muted}
                className={
                  fitMode === 'actual'
                    ? 'max-w-none'
                    : 'w-full h-full object-contain pointer-events-none'
                }
              />
            )}

            {/* Synchronized SVG Annotation Layer */}
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 w-full h-full pointer-events-none"
            >
              {annotations.map((stroke) => (
                <path
                  key={stroke.id}
                  d={toSvgPath(stroke.points)}
                  fill="none"
                  stroke={stroke.color}
                  strokeWidth="0.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {draftPoints && draftPoints.length > 1 && (
                <path
                  d={toSvgPath(draftPoints)}
                  fill="none"
                  stroke={inkColor}
                  strokeWidth="0.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </svg>

            {/* Remote Laser Pointer Overlay */}
            {remotePointer && Date.now() - remotePointer.updatedAt < 8000 && (
              <div
                className="absolute pointer-events-none -translate-x-1.5 -translate-y-1.5 transition-transform duration-75"
                style={{
                  left: `${remotePointer.x * 100}%`,
                  top: `${remotePointer.y * 100}%`,
                }}
              >
                <div
                  className={`w-3.5 h-3.5 rounded-full border-2 border-white shadow ${
                    remotePointer.activeClick ? 'bg-red-500 scale-125' : 'bg-blue-500'
                  }`}
                />
                <span className="mt-1 inline-block px-1.5 py-0.5 text-[10px] font-medium bg-slate-900/90 text-white rounded whitespace-nowrap">
                  {remotePointer.name}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-10 text-center max-w-md">
            <Monitor className="w-10 h-10 text-slate-500 mb-3" />
            <p className="text-sm font-medium text-slate-200 mb-1">
              {session.role === 'host'
                ? 'Your session is active. Select a screen or window to share.'
                : `Connected to ${session.remoteName}. Waiting for host screen stream...`}
            </p>
            {session.role === 'host' && (
              <button
                onClick={onStartShare}
                className="mt-4 px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                {labels.shareScreen}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
