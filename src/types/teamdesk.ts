export type PeerStatus = 'available' | 'sharing' | 'in-session' | 'busy';

export type AccessMode = 'view' | 'assist' | 'control';

export type TransportMode = 'connecting' | 'p2p' | 'turn' | 'wss-relay';

export interface CustomTurnConfig {
  enabled: boolean;
  urls: string;
  username: string;
  credential: string;
}

export interface PeerSummary {
  peerId: string;
  displayName: string;
  workspaceCode: string;
  roleTitle: string;
  osPlatform: string;
  status: PeerStatus;
  unattendedEnabled: boolean;
  hasCompanionAgent: boolean;
  isSharingScreen: boolean;
  connectedAt: string;
}

export interface SavedContact {
  peerId: string;
  displayName: string;
  roleTitle: string;
  workspaceCode: string;
  notes?: string;
  addedAt: string;
  lastConnectedAt?: string;
}

export interface SessionHistoryEntry {
  id: string;
  hostPeerId: string;
  hostName: string;
  viewerPeerId: string;
  viewerName: string;
  mode: AccessMode;
  startedAt: string;
  endedAt?: string;
  durationSeconds?: number;
  status: 'active' | 'completed' | 'declined' | 'failed';
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  senderPeerId: string;
  senderName: string;
  text: string;
  timestamp: string;
}

export interface FileTransferItem {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  direction: 'outgoing' | 'incoming';
  progress: number;
  status: 'pending' | 'transferring' | 'completed' | 'failed';
  senderName: string;
  downloadUrl?: string;
  timestamp: string;
}

export interface AnnotationStroke {
  id: string;
  authorPeerId: string;
  color: string;
  points: Array<{ x: number; y: number }>;
  createdAt: number;
}

export interface RemotePointer {
  peerId: string;
  name: string;
  x: number;
  y: number;
  activeClick?: boolean;
  updatedAt: number;
}

export interface RemoteInputEvent {
  kind:
    | 'mouse_move'
    | 'mouse_click'
    | 'mouse_dblclick'
    | 'mouse_rightclick'
    | 'mouse_scroll'
    | 'key_tap'
    | 'type_text'
    | 'hotkey';
  xNorm?: number;
  yNorm?: number;
  deltaY?: number;
  key?: string;
  text?: string;
  modifiers?: string[];
}

export interface IncomingSessionRequest {
  sessionId: string;
  fromPeerId: string;
  fromName: string;
  requestedMode: AccessMode;
  timestamp: string;
}

export interface ActiveSessionState {
  sessionId: string;
  role: 'host' | 'viewer';
  remotePeerId: string;
  remoteName: string;
  mode: AccessMode;
  startedAt: string;
  iceState: string;
  transportMode: TransportMode;
  dataChannelOpen: boolean;
  remoteAgentConnected: boolean;
}
