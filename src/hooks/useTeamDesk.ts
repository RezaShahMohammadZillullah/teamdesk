import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AccessMode,
  ActiveSessionState,
  AnnotationStroke,
  ChatMessage,
  CustomTurnConfig,
  FileTransferItem,
  IncomingSessionRequest,
  PeerStatus,
  PeerSummary,
  RemoteInputEvent,
  RemotePointer,
  SavedContact,
  SessionHistoryEntry,
  TransportMode,
} from '../types/teamdesk';

interface LocalIdentity {
  preferredPeerId: string;
  displayName: string;
  roleTitle: string;
  workspaceCode: string;
  unattendedEnabled: boolean;
  pinCode: string;
}

export interface StreamTelemetry {
  width: number;
  height: number;
  fps: number;
  rttMs: number | null;
  kbps: number;
}

export interface RelayedFrame {
  dataUrl: string;
  width: number;
  height: number;
  ts: number;
}

const STORAGE_KEY = 'teamdesk_identity_v1';
const TURN_STORAGE_KEY = 'teamdesk_turn_v1';
const CHUNK_SIZE = 16384;
const WS_FILE_CHUNK_SIZE = 49152;

function detectOs(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Win')) return 'Windows';
  if (ua.includes('Mac')) return 'macOS';
  if (ua.includes('Linux')) return 'Linux';
  return 'Web';
}

function loadIdentity(): LocalIdentity {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalIdentity>;
      return {
        preferredPeerId: parsed.preferredPeerId || '',
        displayName: parsed.displayName || 'Team Member',
        roleTitle: parsed.roleTitle || 'Engineer',
        workspaceCode: parsed.workspaceCode || 'TEAM-CORE',
        unattendedEnabled: Boolean(parsed.unattendedEnabled),
        pinCode: parsed.pinCode || '',
      };
    }
  } catch {
    // ignore
  }
  return {
    preferredPeerId: '',
    displayName: 'Team Member',
    roleTitle: 'Engineer',
    workspaceCode: 'TEAM-CORE',
    unattendedEnabled: false,
    pinCode: '',
  };
}

function saveIdentity(identity: LocalIdentity): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // ignore
  }
}

function loadTurnConfig(): CustomTurnConfig {
  try {
    const raw = localStorage.getItem(TURN_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CustomTurnConfig>;
      return {
        enabled: Boolean(parsed.enabled),
        urls: parsed.urls || '',
        username: parsed.username || '',
        credential: parsed.credential || '',
      };
    }
  } catch {
    // ignore
  }
  return { enabled: false, urls: '', username: '', credential: '' };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function useTeamDesk() {
  const [identity, setIdentity] = useState<LocalIdentity>(() => loadIdentity());
  const [customTurn, setCustomTurn] = useState<CustomTurnConfig>(() => loadTurnConfig());
  const [wsConnected, setWsConnected] = useState(false);
  const [selfPeer, setSelfPeer] = useState<PeerSummary | null>(null);
  const [agentToken, setAgentToken] = useState<string>('');
  const [directoryPeers, setDirectoryPeers] = useState<PeerSummary[]>([]);
  const [contacts, setContacts] = useState<SavedContact[]>([]);
  const [sessionHistory, setSessionHistory] = useState<SessionHistoryEntry[]>([]);

  const [pendingOutgoing, setPendingOutgoing] = useState<{
    sessionId: string;
    targetPeerId: string;
    targetName: string;
  } | null>(null);
  const [incomingRequest, setIncomingRequest] = useState<IncomingSessionRequest | null>(null);
  const [activeSession, setActiveSession] = useState<ActiveSessionState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [relayedFrame, setRelayedFrame] = useState<RelayedFrame | null>(null);
  const [micEnabled, setMicEnabled] = useState(false);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [fileTransfers, setFileTransfers] = useState<FileTransferItem[]>([]);
  const [sharedClipboard, setSharedClipboard] = useState<string>('');
  const [annotations, setAnnotations] = useState<AnnotationStroke[]>([]);
  const [remotePointer, setRemotePointer] = useState<RemotePointer | null>(null);
  const [telemetry, setTelemetry] = useState<StreamTelemetry | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  const activeSessionRef = useRef<ActiveSessionState | null>(null);
  const identityRef = useRef<LocalIdentity>(identity);
  const customTurnRef = useRef<CustomTurnConfig>(customTurn);
  const selfPeerRef = useRef<PeerSummary | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const prevBytesRef = useRef<{ bytes: number; ts: number } | null>(null);
  const relayStatsRef = useRef<{ frames: number; bytes: number; windowStart: number }>({
    frames: 0,
    bytes: 0,
    windowStart: Date.now(),
  });

  const incomingFileBuffersRef = useRef<
    Map<
      string,
      {
        name: string;
        size: number;
        mimeType: string;
        senderName: string;
        chunks: Uint8Array[];
        receivedBytes: number;
      }
    >
  >(new Map());

  identityRef.current = identity;
  customTurnRef.current = customTurn;
  activeSessionRef.current = activeSession;
  selfPeerRef.current = selfPeer;
  localStreamRef.current = localStream;

  const sendWs = useCallback((event: string, payload: Record<string, unknown>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ event, payload }));
    }
  }, []);

  const refreshWorkspaceData = useCallback(async () => {
    try {
      const res = await fetch('/api/workspace');
      if (res.ok) {
        const data = (await res.json()) as {
          contacts: SavedContact[];
          sessions: SessionHistoryEntry[];
        };
        setContacts(data.contacts || []);
        setSessionHistory(data.sessions || []);
      }
    } catch {
      // ignore transient fetch errors
    }
  }, []);

  const cleanupPeerConnection = useCallback(() => {
    if (dcRef.current) {
      try {
        dcRef.current.close();
      } catch {
        // ignore
      }
      dcRef.current = null;
    }
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {
        // ignore
      }
      pcRef.current = null;
    }
    pendingIceRef.current = [];
    prevBytesRef.current = null;
    setRemoteStream(null);
    setRelayedFrame(null);
    setTelemetry(null);
    setRemotePointer(null);
  }, []);

  const stopScreenShare = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      setLocalStream(null);
    }
    if (micTrackRef.current) {
      micTrackRef.current.stop();
      micTrackRef.current = null;
      setMicEnabled(false);
    }
    sendWs('peer:update', { isSharingScreen: false });
  }, [sendWs]);

  const handleIncomingFileStart = useCallback(
    (id: string, name: string, size: number, mimeType: string, senderName: string) => {
      incomingFileBuffersRef.current.set(id, {
        name,
        size,
        mimeType,
        senderName,
        chunks: [],
        receivedBytes: 0,
      });
      setFileTransfers((prev) => [
        {
          id,
          name,
          size,
          mimeType,
          direction: 'incoming',
          progress: 0,
          status: 'transferring',
          senderName,
          timestamp: new Date().toISOString(),
        },
        ...prev,
      ]);
    },
    []
  );

  const handleIncomingFileChunk = useCallback((id: string, arr: Uint8Array) => {
    const buf = incomingFileBuffersRef.current.get(id);
    if (!buf) return;
    buf.chunks.push(arr);
    buf.receivedBytes += arr.byteLength;
    const pct = buf.size > 0 ? Math.min(100, Math.round((buf.receivedBytes / buf.size) * 100)) : 100;
    setFileTransfers((prev) => prev.map((f) => (f.id === id ? { ...f, progress: pct } : f)));
  }, []);

  const handleIncomingFileEnd = useCallback((id: string) => {
    const buf = incomingFileBuffersRef.current.get(id);
    if (!buf) return;
    incomingFileBuffersRef.current.delete(id);
    const blob = new Blob(buf.chunks as BlobPart[], { type: buf.mimeType });
    const downloadUrl = URL.createObjectURL(blob);
    setFileTransfers((prev) =>
      prev.map((f) =>
        f.id === id ? { ...f, progress: 100, status: 'completed', downloadUrl } : f
      )
    );
  }, []);

  const handleDataMessage = useCallback(
    (raw: string | ArrayBuffer) => {
      if (typeof raw !== 'string') {
        const arr = new Uint8Array(raw);
        const entries = Array.from(incomingFileBuffersRef.current.entries());
        const activeEntry = entries[entries.length - 1];
        if (!activeEntry) return;
        handleIncomingFileChunk(activeEntry[0], arr);
        return;
      }

      let msg: { type?: string; [key: string]: unknown };
      try {
        msg = JSON.parse(raw) as { type?: string; [key: string]: unknown };
      } catch {
        return;
      }

      if (msg.type === 'chat') {
        const chat = msg.message as ChatMessage;
        setChatMessages((prev) => (prev.some((m) => m.id === chat.id) ? prev : [...prev, chat]));
      } else if (msg.type === 'clipboard') {
        setSharedClipboard(String(msg.text || ''));
      } else if (msg.type === 'pointer') {
        setRemotePointer(msg.pointer as RemotePointer);
      } else if (msg.type === 'annotation-add') {
        const stroke = msg.stroke as AnnotationStroke;
        setAnnotations((prev) => (prev.some((s) => s.id === stroke.id) ? prev : [...prev, stroke]));
      } else if (msg.type === 'annotation-clear') {
        setAnnotations([]);
      } else if (msg.type === 'file-start') {
        handleIncomingFileStart(
          String(msg.id),
          String(msg.name || 'file'),
          Number(msg.size || 0),
          String(msg.mimeType || 'application/octet-stream'),
          String(msg.senderName || 'Teammate')
        );
      } else if (msg.type === 'file-end') {
        handleIncomingFileEnd(String(msg.id));
      }
    },
    [handleIncomingFileChunk, handleIncomingFileEnd, handleIncomingFileStart]
  );

  const setupDataChannel = useCallback(
    (dc: RTCDataChannel) => {
      dc.binaryType = 'arraybuffer';
      dcRef.current = dc;
      dc.onopen = () => {
        setActiveSession((prev) => (prev ? { ...prev, dataChannelOpen: true } : prev));
      };
      dc.onclose = () => {
        setActiveSession((prev) => (prev ? { ...prev, dataChannelOpen: false } : prev));
      };
      dc.onmessage = (ev) => {
        handleDataMessage(ev.data as string | ArrayBuffer);
      };
    },
    [handleDataMessage]
  );

  const switchTransportMode = useCallback(
    (mode: TransportMode) => {
      const sess = activeSessionRef.current;
      if (!sess) return;
      setActiveSession((prev) => (prev ? { ...prev, transportMode: mode } : prev));
      sendWs('relay:transport', { sessionId: sess.sessionId, transportMode: mode });
    },
    [sendWs]
  );

  const createPeerConnection = useCallback(
    async (sessionId: string, isHost: boolean): Promise<RTCPeerConnection> => {
      cleanupPeerConnection();

      let iceServers: RTCIceServer[] = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ];
      try {
        const res = await fetch('/api/ice-servers');
        if (res.ok) {
          const data = (await res.json()) as { iceServers: RTCIceServer[] };
          if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
            iceServers = data.iceServers;
          }
        }
      } catch {
        // fallback to default STUN
      }

      const turnCfg = customTurnRef.current;
      if (turnCfg.enabled && turnCfg.urls.trim()) {
        iceServers.push({
          urls: turnCfg.urls
            .split(',')
            .map((u) => u.trim())
            .filter(Boolean),
          username: turnCfg.username.trim() || undefined,
          credential: turnCfg.credential.trim() || undefined,
        });
      }

      const pc = new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 4 });
      pcRef.current = pc;

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          sendWs('webrtc:ice-candidate', {
            sessionId,
            candidate: ev.candidate.toJSON(),
          });
        }
      };

      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        setActiveSession((prev) => {
          if (!prev || prev.sessionId !== sessionId) return prev;
          let nextTransport = prev.transportMode;
          if (state === 'failed' || state === 'disconnected') {
            nextTransport = 'wss-relay';
          }
          return { ...prev, iceState: state, transportMode: nextTransport };
        });

        if (state === 'failed' || state === 'disconnected') {
          sendWs('relay:transport', { sessionId, transportMode: 'wss-relay' });
        }
      };

      pc.ontrack = (ev) => {
        const stream = ev.streams[0] || new MediaStream([ev.track]);
        setRemoteStream(stream);
      };

      if (isHost) {
        const dc = pc.createDataChannel('teamdesk-data', { ordered: true });
        setupDataChannel(dc);

        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((track) => {
            pc.addTrack(track, localStreamRef.current!);
          });
        }
        if (micTrackRef.current) {
          const micStream = new MediaStream([micTrackRef.current]);
          pc.addTrack(micTrackRef.current, micStream);
        }
      } else {
        pc.ondatachannel = (ev) => {
          setupDataChannel(ev.channel);
        };
      }

      return pc;
    },
    [cleanupPeerConnection, sendWs, setupDataChannel]
  );

  const sendOffer = useCallback(
    async (sessionId: string) => {
      const pc = pcRef.current;
      if (!pc) return;
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await pc.setLocalDescription(offer);
      sendWs('webrtc:offer', { sessionId, sdp: offer });
    },
    [sendWs]
  );

  const startScreenShare = useCallback(async (): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 60, max: 60 },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: true,
      });

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      localStreamRef.current = stream;
      setLocalStream(stream);
      sendWs('peer:update', { isSharingScreen: true });

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          stopScreenShare();
        };
      }

      const sess = activeSessionRef.current;
      const pc = pcRef.current;
      if (sess && sess.role === 'host' && pc) {
        pc.getSenders().forEach((sender) => {
          if (sender.track && sender.track !== micTrackRef.current) {
            pc.removeTrack(sender);
          }
        });
        stream.getTracks().forEach((track) => {
          pc.addTrack(track, stream);
        });
        await sendOffer(sess.sessionId);
      }

      return stream;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Screen sharing permission denied.';
      setErrorMessage(msg);
      return null;
    }
  }, [sendOffer, sendWs, stopScreenShare]);

  const toggleMicrophone = useCallback(async () => {
    if (micTrackRef.current) {
      micTrackRef.current.stop();
      if (pcRef.current) {
        const sender = pcRef.current.getSenders().find((s) => s.track === micTrackRef.current);
        if (sender) pcRef.current.removeTrack(sender);
      }
      micTrackRef.current = null;
      setMicEnabled(false);
      if (activeSessionRef.current?.role === 'host') {
        await sendOffer(activeSessionRef.current.sessionId);
      }
      return;
    }
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const track = audioStream.getAudioTracks()[0];
      micTrackRef.current = track;
      setMicEnabled(true);
      if (pcRef.current) {
        pcRef.current.addTrack(track, audioStream);
        if (activeSessionRef.current?.role === 'host') {
          await sendOffer(activeSessionRef.current.sessionId);
        }
      }
    } catch {
      setErrorMessage('Microphone permission is required for voice audio.');
    }
  }, [sendOffer]);

  useEffect(() => {
    refreshWorkspaceData();

    let closedByCleanup = false;
    let reconnectTimer: number | null = null;

    const connectWs = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        const id = identityRef.current;
        ws.send(
          JSON.stringify({
            event: 'peer:register',
            payload: {
              preferredPeerId: id.preferredPeerId,
              displayName: id.displayName,
              roleTitle: id.roleTitle,
              workspaceCode: id.workspaceCode,
              osPlatform: detectOs(),
              unattendedEnabled: id.unattendedEnabled,
              pinCode: id.pinCode,
              isSharingScreen: Boolean(localStreamRef.current),
            },
          })
        );
      };

      ws.onmessage = async (ev) => {
        let parsed: { event?: string; payload?: Record<string, unknown> };
        try {
          parsed = JSON.parse(String(ev.data)) as {
            event?: string;
            payload?: Record<string, unknown>;
          };
        } catch {
          return;
        }

        const event = parsed.event;
        const payload = parsed.payload || {};

        if (event === 'peer:registered') {
          const peer = payload.peer as PeerSummary;
          const token = String(payload.agentToken || '');
          setSelfPeer(peer);
          setAgentToken(token);
          const updatedId = { ...identityRef.current, preferredPeerId: peer.peerId };
          setIdentity(updatedId);
          saveIdentity(updatedId);
        } else if (event === 'peer:updated') {
          setSelfPeer(payload.peer as PeerSummary);
        } else if (event === 'peer:directory') {
          setDirectoryPeers((payload.peers as PeerSummary[]) || []);
        } else if (event === 'agent:status') {
          const connected = Boolean(payload.connected);
          setSelfPeer((prev) => (prev ? { ...prev, hasCompanionAgent: connected } : prev));
        } else if (event === 'session:error') {
          setPendingOutgoing(null);
          setErrorMessage(String(payload.message || 'Connection failed.'));
        } else if (event === 'session:pending') {
          setPendingOutgoing({
            sessionId: String(payload.sessionId),
            targetPeerId: String(payload.targetPeerId),
            targetName: String(payload.targetName),
          });
        } else if (event === 'session:incoming') {
          setIncomingRequest({
            sessionId: String(payload.sessionId),
            fromPeerId: String(payload.fromPeerId),
            fromName: String(payload.fromName),
            requestedMode: (payload.requestedMode as AccessMode) || 'assist',
            timestamp: String(payload.timestamp || new Date().toISOString()),
          });
        } else if (event === 'session:accepted') {
          setPendingOutgoing(null);
          setIncomingRequest(null);
          setChatMessages([]);
          setAnnotations([]);
          setRelayedFrame(null);
          setErrorMessage(null);

          const sessionId = String(payload.sessionId);
          const role = payload.role as 'host' | 'viewer';
          const mode = (payload.mode as AccessMode) || 'assist';

          const sessState: ActiveSessionState = {
            sessionId,
            role,
            remotePeerId: String(payload.remotePeerId),
            remoteName: String(payload.remoteName),
            mode,
            startedAt: new Date().toISOString(),
            iceState: 'new',
            transportMode: 'connecting',
            dataChannelOpen: false,
            remoteAgentConnected: Boolean(payload.remoteAgentConnected),
          };
          setActiveSession(sessState);
          activeSessionRef.current = sessState;

          const pc = await createPeerConnection(sessionId, role === 'host');
          if (role === 'host') {
            const offer = await pc.createOffer({
              offerToReceiveAudio: true,
              offerToReceiveVideo: true,
            });
            await pc.setLocalDescription(offer);
            sendWs('webrtc:offer', { sessionId, sdp: offer });
          }
          refreshWorkspaceData();
        } else if (event === 'webrtc:offer') {
          const sessionId = String(payload.sessionId);
          const sdp = payload.sdp as RTCSessionDescriptionInit;
          let pc = pcRef.current;
          if (!pc) {
            pc = await createPeerConnection(sessionId, false);
          }
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          for (const cand of pendingIceRef.current) {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          }
          pendingIceRef.current = [];
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendWs('webrtc:answer', { sessionId, sdp: answer });
        } else if (event === 'webrtc:answer') {
          const sdp = payload.sdp as RTCSessionDescriptionInit;
          const pc = pcRef.current;
          if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
            for (const cand of pendingIceRef.current) {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            }
            pendingIceRef.current = [];
          }
        } else if (event === 'webrtc:ice-candidate') {
          const candidate = payload.candidate as RTCIceCandidateInit;
          const pc = pcRef.current;
          if (pc && pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } else {
            pendingIceRef.current.push(candidate);
          }
        } else if (event === 'session:mode-update') {
          const mode = payload.mode as AccessMode;
          setActiveSession((prev) => (prev ? { ...prev, mode } : prev));
        } else if (event === 'relay:transport') {
          const mode = (payload.transportMode as TransportMode) || 'wss-relay';
          setActiveSession((prev) => (prev ? { ...prev, transportMode: mode } : prev));
        } else if (event === 'relay:frame') {
          const dataUrl = String(payload.dataUrl || '');
          const width = Number(payload.width || 0);
          const height = Number(payload.height || 0);
          if (dataUrl) {
            setRelayedFrame({ dataUrl, width, height, ts: Date.now() });
            relayStatsRef.current.frames += 1;
            relayStatsRef.current.bytes += dataUrl.length;
          }
        } else if (event === 'relay:file-start') {
          handleIncomingFileStart(
            String(payload.id),
            String(payload.name || 'file'),
            Number(payload.size || 0),
            String(payload.mimeType || 'application/octet-stream'),
            String(payload.senderName || 'Teammate')
          );
        } else if (event === 'relay:file-chunk') {
          const id = String(payload.id);
          const chunkB64 = String(payload.chunk || '');
          if (chunkB64) {
            handleIncomingFileChunk(id, base64ToUint8Array(chunkB64));
          }
        } else if (event === 'relay:file-end') {
          handleIncomingFileEnd(String(payload.id));
        } else if (event === 'relay:chat') {
          const chat = payload.message as ChatMessage;
          setChatMessages((prev) => (prev.some((m) => m.id === chat.id) ? prev : [...prev, chat]));
        } else if (event === 'relay:pointer') {
          setRemotePointer(payload.pointer as RemotePointer);
        } else if (event === 'relay:annotation') {
          if (payload.clear) {
            setAnnotations([]);
          } else if (payload.stroke) {
            const stroke = payload.stroke as AnnotationStroke;
            setAnnotations((prev) =>
              prev.some((s) => s.id === stroke.id) ? prev : [...prev, stroke]
            );
          }
        } else if (event === 'relay:clipboard') {
          setSharedClipboard(String(payload.text || ''));
        } else if (event === 'session:ended') {
          const reason = payload.reason ? String(payload.reason) : null;
          setPendingOutgoing(null);
          setIncomingRequest(null);
          setActiveSession(null);
          activeSessionRef.current = null;
          cleanupPeerConnection();
          refreshWorkspaceData();
          if (reason && payload.status === 'declined') {
            setErrorMessage(reason);
          }
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!closedByCleanup) {
          reconnectTimer = window.setTimeout(connectWs, 2000);
        }
      };
    };

    connectWs();

    return () => {
      closedByCleanup = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      cleanupPeerConnection();
      wsRef.current?.close();
    };
  }, [
    cleanupPeerConnection,
    createPeerConnection,
    handleIncomingFileChunk,
    handleIncomingFileEnd,
    handleIncomingFileStart,
    refreshWorkspaceData,
    sendWs,
  ]);

  // Automatic 7-second Firewall / Mobile CGNAT fallback if direct WebRTC ICE fails to connect
  useEffect(() => {
    if (!activeSession || activeSession.transportMode !== 'connecting') return;

    const timer = window.setTimeout(() => {
      const pc = pcRef.current;
      const sess = activeSessionRef.current;
      if (!sess || sess.transportMode !== 'connecting') return;
      const connected =
        pc && (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed');
      if (!connected) {
        setActiveSession((prev) => (prev ? { ...prev, transportMode: 'wss-relay' } : prev));
        sendWs('relay:transport', { sessionId: sess.sessionId, transportMode: 'wss-relay' });
      }
    }, 7000);

    return () => window.clearTimeout(timer);
  }, [activeSession, sendWs]);

  // Host frame broadcaster when session falls back to HTTPS/WSS Firewall Relay mode
  useEffect(() => {
    if (!activeSession || activeSession.role !== 'host' || activeSession.transportMode !== 'wss-relay') {
      return;
    }
    if (!localStream) return;

    const video = document.createElement('video');
    video.srcObject = localStream;
    video.muted = true;
    video.playsInline = true;
    video.play().catch(() => {});

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const interval = window.setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 512 * 1024) return;
      if (video.videoWidth === 0 || video.videoHeight === 0 || !ctx) return;

      const scale = Math.min(1, 1280 / video.videoWidth);
      const w = Math.round(video.videoWidth * scale);
      const h = Math.round(video.videoHeight * scale);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      ctx.drawImage(video, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      sendWs('relay:frame', {
        sessionId: activeSession.sessionId,
        dataUrl,
        width: w,
        height: h,
      });

      relayStatsRef.current.frames += 1;
      relayStatsRef.current.bytes += dataUrl.length;
    }, 85); // ~12 FPS smooth adaptive relay

    return () => {
      window.clearInterval(interval);
      video.srcObject = null;
    };
  }, [activeSession, localStream, sendWs]);

  // Real WebRTC getStats() & transport type detection every 2s
  useEffect(() => {
    if (!activeSession) {
      setTelemetry(null);
      return;
    }

    const timer = window.setInterval(async () => {
      const sess = activeSessionRef.current;
      if (!sess) return;

      if (sess.transportMode === 'wss-relay') {
        const now = Date.now();
        const dt = Math.max(0.5, (now - relayStatsRef.current.windowStart) / 1000);
        const fps = Math.round(relayStatsRef.current.frames / dt);
        const kbps = Math.round((relayStatsRef.current.bytes * 8) / dt / 1000);
        relayStatsRef.current = { frames: 0, bytes: 0, windowStart: now };
        setTelemetry({
          width: relayedFrame?.width || 1280,
          height: relayedFrame?.height || 720,
          fps,
          rttMs: null,
          kbps,
        });
        return;
      }

      const pc = pcRef.current;
      if (!pc) return;
      try {
        const stats = await pc.getStats();
        let width = 0;
        let height = 0;
        let fps = 0;
        let rttMs: number | null = null;
        let bytes = 0;
        let activeCandidatePairId: string | null = null;
        const remoteCandidates = new Map<string, string>();

        stats.forEach((report) => {
          if (
            (report.type === 'inbound-rtp' || report.type === 'outbound-rtp') &&
            report.kind === 'video'
          ) {
            if (typeof report.frameWidth === 'number') width = report.frameWidth;
            if (typeof report.frameHeight === 'number') height = report.frameHeight;
            if (typeof report.framesPerSecond === 'number') fps = Math.round(report.framesPerSecond);
            const b = report.bytesReceived ?? report.bytesSent;
            if (typeof b === 'number') bytes += b;
          }
          if (report.type === 'remote-candidate') {
            remoteCandidates.set(report.id, String(report.candidateType || ''));
          }
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            if (typeof report.currentRoundTripTime === 'number') {
              rttMs = Math.round(report.currentRoundTripTime * 1000);
            }
            if (report.nominated || !activeCandidatePairId) {
              activeCandidatePairId = String(report.remoteCandidateId || '');
            }
          }
        });

        if (
          activeCandidatePairId &&
          (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed')
        ) {
          const candType = remoteCandidates.get(activeCandidatePairId);
          const detected: TransportMode = candType === 'relay' ? 'turn' : 'p2p';
          if (sess.transportMode !== detected && sess.transportMode === 'connecting') {
            setActiveSession((prev) => (prev ? { ...prev, transportMode: detected } : prev));
          }
        }

        let kbps = 0;
        const now = Date.now();
        if (prevBytesRef.current && bytes >= prevBytesRef.current.bytes) {
          const dt = (now - prevBytesRef.current.ts) / 1000;
          if (dt > 0) {
            kbps = Math.round(((bytes - prevBytesRef.current.bytes) * 8) / dt / 1000);
          }
        }
        prevBytesRef.current = { bytes, ts: now };

        setTelemetry({ width, height, fps, rttMs, kbps });
      } catch {
        // ignore transient stats error
      }
    }, 2000);

    return () => window.clearInterval(timer);
  }, [activeSession, relayedFrame?.height, relayedFrame?.width]);

  const updateIdentity = useCallback(
    (next: Partial<LocalIdentity>) => {
      const merged = { ...identityRef.current, ...next };
      setIdentity(merged);
      saveIdentity(merged);
      sendWs('peer:update', {
        displayName: merged.displayName,
        roleTitle: merged.roleTitle,
        workspaceCode: merged.workspaceCode,
        unattendedEnabled: merged.unattendedEnabled,
        pinCode: merged.pinCode,
      });
    },
    [sendWs]
  );

  const updateCustomTurn = useCallback((next: CustomTurnConfig) => {
    setCustomTurn(next);
    try {
      localStorage.setItem(TURN_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  const setAvailability = useCallback(
    (status: PeerStatus) => {
      sendWs('peer:update', { status });
    },
    [sendWs]
  );

  const requestSession = useCallback(
    (targetPeerId: string, mode: AccessMode, pin?: string) => {
      setErrorMessage(null);
      sendWs('session:request', { targetPeerId, mode, pin: pin || '' });
    },
    [sendWs]
  );

  const respondToIncoming = useCallback(
    async (accepted: boolean, grantedMode: AccessMode) => {
      if (!incomingRequest) return;
      const req = incomingRequest;
      setIncomingRequest(null);

      if (accepted && !localStreamRef.current) {
        await startScreenShare();
      }

      sendWs('session:respond', {
        sessionId: req.sessionId,
        accepted,
        grantedMode,
      });
    },
    [incomingRequest, sendWs, startScreenShare]
  );

  const endActiveSession = useCallback(() => {
    if (!activeSessionRef.current) return;
    sendWs('session:end', { sessionId: activeSessionRef.current.sessionId });
    setActiveSession(null);
    activeSessionRef.current = null;
    cleanupPeerConnection();
  }, [cleanupPeerConnection, sendWs]);

  const updateSessionMode = useCallback(
    (mode: AccessMode) => {
      if (!activeSessionRef.current || activeSessionRef.current.role !== 'host') return;
      setActiveSession((prev) => (prev ? { ...prev, mode } : prev));
      sendWs('session:mode-update', {
        sessionId: activeSessionRef.current.sessionId,
        mode,
      });
    },
    [sendWs]
  );

  const sendDataOrRelay = useCallback(
    (dcPayload: Record<string, unknown>, relayEvent: string, relayPayload: Record<string, unknown>) => {
      const dc = dcRef.current;
      if (dc && dc.readyState === 'open') {
        dc.send(JSON.stringify(dcPayload));
      } else if (activeSessionRef.current) {
        sendWs(relayEvent, {
          sessionId: activeSessionRef.current.sessionId,
          ...relayPayload,
        });
      }
    },
    [sendWs]
  );

  const sendChatMessage = useCallback(
    (text: string) => {
      if (!text.trim() || !activeSessionRef.current || !selfPeerRef.current) return;
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        sessionId: activeSessionRef.current.sessionId,
        senderPeerId: selfPeerRef.current.peerId,
        senderName: selfPeerRef.current.displayName,
        text: text.trim(),
        timestamp: new Date().toISOString(),
      };
      setChatMessages((prev) => [...prev, message]);
      sendDataOrRelay({ type: 'chat', message }, 'relay:chat', { message });
    },
    [sendDataOrRelay]
  );

  const sendClipboard = useCallback(
    (text: string) => {
      setSharedClipboard(text);
      sendDataOrRelay({ type: 'clipboard', text }, 'relay:clipboard', { text });
    },
    [sendDataOrRelay]
  );

  const sendPointer = useCallback(
    (x: number, y: number, activeClick = false) => {
      if (!selfPeerRef.current) return;
      const pointer: RemotePointer = {
        peerId: selfPeerRef.current.peerId,
        name: selfPeerRef.current.displayName,
        x,
        y,
        activeClick,
        updatedAt: Date.now(),
      };
      sendDataOrRelay({ type: 'pointer', pointer }, 'relay:pointer', { pointer });
    },
    [sendDataOrRelay]
  );

  const sendAnnotationStroke = useCallback(
    (stroke: AnnotationStroke) => {
      setAnnotations((prev) => [...prev, stroke]);
      sendDataOrRelay({ type: 'annotation-add', stroke }, 'relay:annotation', { stroke });
    },
    [sendDataOrRelay]
  );

  const clearAnnotations = useCallback(() => {
    setAnnotations([]);
    sendDataOrRelay({ type: 'annotation-clear' }, 'relay:annotation', { clear: true });
  }, [sendDataOrRelay]);

  const sendRemoteInput = useCallback(
    (input: RemoteInputEvent) => {
      if (!activeSessionRef.current) return;
      sendWs('control:input', {
        sessionId: activeSessionRef.current.sessionId,
        input,
      });
    },
    [sendWs]
  );

  const sendFile = useCallback(
    async (file: File) => {
      const sess = activeSessionRef.current;
      if (!sess) return;

      const id = crypto.randomUUID();
      const senderName = selfPeerRef.current?.displayName || 'You';
      const dc = dcRef.current;
      const useDataChannel = dc && dc.readyState === 'open';

      setFileTransfers((prev) => [
        {
          id,
          name: file.name,
          size: file.size,
          mimeType: file.type || 'application/octet-stream',
          direction: 'outgoing',
          progress: 0,
          status: 'transferring',
          senderName,
          timestamp: new Date().toISOString(),
        },
        ...prev,
      ]);

      const buffer = await file.arrayBuffer();

      if (useDataChannel) {
        dc.send(
          JSON.stringify({
            type: 'file-start',
            id,
            name: file.name,
            size: file.size,
            mimeType: file.type || 'application/octet-stream',
            senderName,
          })
        );

        let offset = 0;
        while (offset < buffer.byteLength) {
          if (dc.bufferedAmount > 1_000_000) {
            await new Promise<void>((resolve) => {
              const onLow = () => {
                dc.removeEventListener('bufferedamountlow', onLow);
                resolve();
              };
              dc.bufferedAmountLowThreshold = 256_000;
              dc.addEventListener('bufferedamountlow', onLow);
              setTimeout(resolve, 100);
            });
          }
          const slice = buffer.slice(offset, offset + CHUNK_SIZE);
          dc.send(slice);
          offset += slice.byteLength;
          const pct = Math.min(100, Math.round((offset / buffer.byteLength) * 100));
          setFileTransfers((prev) =>
            prev.map((f) => (f.id === id ? { ...f, progress: pct } : f))
          );
        }

        dc.send(JSON.stringify({ type: 'file-end', id }));
      } else {
        // HTTPS/WSS Firewall Relay fallback for file transfers
        sendWs('relay:file-start', {
          sessionId: sess.sessionId,
          id,
          name: file.name,
          size: file.size,
          mimeType: file.type || 'application/octet-stream',
          senderName,
        });

        let offset = 0;
        while (offset < buffer.byteLength) {
          const slice = buffer.slice(offset, offset + WS_FILE_CHUNK_SIZE);
          sendWs('relay:file-chunk', {
            sessionId: sess.sessionId,
            id,
            chunk: arrayBufferToBase64(slice),
          });
          offset += slice.byteLength;
          const pct = Math.min(100, Math.round((offset / buffer.byteLength) * 100));
          setFileTransfers((prev) =>
            prev.map((f) => (f.id === id ? { ...f, progress: pct } : f))
          );
          await new Promise((r) => setTimeout(r, 20));
        }

        sendWs('relay:file-end', { sessionId: sess.sessionId, id });
      }

      setFileTransfers((prev) =>
        prev.map((f) => (f.id === id ? { ...f, progress: 100, status: 'completed' } : f))
      );
    },
    [sendWs]
  );

  const saveContact = useCallback(
    async (contact: {
      peerId: string;
      displayName: string;
      roleTitle?: string;
      workspaceCode?: string;
    }) => {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contact),
      });
      if (res.ok) {
        const data = (await res.json()) as { contacts: SavedContact[] };
        setContacts(data.contacts);
      }
    },
    []
  );

  const removeContact = useCallback(async (peerId: string) => {
    const res = await fetch(`/api/contacts/${encodeURIComponent(peerId)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      const data = (await res.json()) as { contacts: SavedContact[] };
      setContacts(data.contacts);
    }
  }, []);

  return {
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
    refreshWorkspaceData,
  };
}
