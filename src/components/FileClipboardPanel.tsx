import React, { useRef, useState } from 'react';
import {
  Clipboard,
  Copy,
  Download,
  FileUp,
  MessageSquare,
  Send,
} from 'lucide-react';
import type { ActiveSessionState, ChatMessage, FileTransferItem } from '../types/teamdesk';

interface FileClipboardPanelProps {
  activeSession: ActiveSessionState | null;
  chatMessages: ChatMessage[];
  fileTransfers: FileTransferItem[];
  sharedClipboard: string;
  selfPeerId: string;
  labels: Record<string, string>;
  onSendChat: (text: string) => void;
  onSendFile: (file: File) => void;
  onSendClipboard: (text: string) => void;
  compact?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const FileClipboardPanel: React.FC<FileClipboardPanelProps> = ({
  activeSession,
  chatMessages,
  fileTransfers,
  sharedClipboard,
  selfPeerId,
  labels,
  onSendChat,
  onSendFile,
  onSendClipboard,
  compact = false,
}) => {
  const [chatInput, setChatInput] = useState('');
  const [clipboardDraft, setClipboardDraft] = useState('');
  const [copiedClip, setCopiedClip] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    onSendChat(chatInput);
    setChatInput('');
  };

  const handleFilesSelected = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => onSendFile(file));
  };

  const copyIncomingClipboard = () => {
    if (!sharedClipboard) return;
    navigator.clipboard.writeText(sharedClipboard).catch(() => {});
    setCopiedClip(true);
    setTimeout(() => setCopiedClip(false), 1500);
  };

  return (
    <div
      className={
        compact
          ? 'flex flex-col gap-4'
          : 'grid grid-cols-1 lg:grid-cols-12 gap-6'
      }
    >
      {/* File Transfer & Clipboard */}
      <div
        className={`${
          compact ? '' : 'lg:col-span-7'
        } rounded-xl border border-slate-200 bg-white p-5 flex flex-col gap-5`}
      >
        <div>
          <h2 className="text-base font-semibold text-slate-900">{labels.filesTitle}</h2>
          <p className="text-xs text-slate-500 mt-1">{labels.filesSubtitle}</p>
        </div>

        {!activeSession ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
            {labels.noActiveSessionFiles}
          </div>
        ) : (
          <>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleFilesSelected(e.dataTransfer.files);
              }}
              className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-center"
            >
              <FileUp className="w-6 h-6 text-slate-400 mx-auto mb-2" />
              <p className="text-xs text-slate-600 mb-3">{labels.dropFiles}</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => handleFilesSelected(e.target.files)}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors"
              >
                {labels.chooseFile}
              </button>
            </div>

            {fileTransfers.length > 0 && (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                {fileTransfers.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-white text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-900 truncate">{item.name}</div>
                      <div className="text-slate-500 tabular-nums mt-0.5">
                        {item.direction === 'outgoing' ? 'Sent' : 'Received'} ·{' '}
                        {formatBytes(item.size)} · {item.progress}%
                      </div>
                      {item.status === 'transferring' && (
                        <div className="w-full h-1 bg-slate-100 rounded-full mt-1.5 overflow-hidden">
                          <div
                            className="h-full bg-blue-600 transition-all"
                            style={{ width: `${item.progress}%` }}
                          />
                        </div>
                      )}
                    </div>
                    {item.downloadUrl && (
                      <a
                        href={item.downloadUrl}
                        download={item.name}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Save
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Shared Clipboard */}
        <div className="pt-4 border-t border-slate-100 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
              <Clipboard className="w-4 h-4 text-slate-500" />
              <span>{labels.clipboardSync}</span>
            </div>
            {sharedClipboard && (
              <button
                onClick={copyIncomingClipboard}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                <Copy className="w-3.5 h-3.5" />
                {copiedClip ? labels.copied : labels.copyClipboard}
              </button>
            )}
          </div>

          {sharedClipboard && (
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs font-mono text-slate-700 whitespace-pre-wrap break-all max-h-28 overflow-auto">
              {sharedClipboard}
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={clipboardDraft}
              onChange={(e) => setClipboardDraft(e.target.value)}
              disabled={!activeSession}
              placeholder={labels.clipboardPlaceholder}
              className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 disabled:bg-slate-50"
            />
            <button
              disabled={!activeSession || !clipboardDraft.trim()}
              onClick={() => {
                onSendClipboard(clipboardDraft);
                setClipboardDraft('');
              }}
              className="px-3.5 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 whitespace-nowrap"
            >
              {labels.pushClipboard}
            </button>
          </div>
        </div>
      </div>

      {/* Live Session Chat */}
      <div
        className={`${
          compact ? '' : 'lg:col-span-5'
        } rounded-xl border border-slate-200 bg-white p-5 flex flex-col justify-between min-h-[340px]`}
      >
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
          <MessageSquare className="w-4 h-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-900">{labels.chatTitle}</h3>
        </div>

        <div className="flex-1 overflow-y-auto py-3 space-y-2.5 max-h-72">
          {chatMessages.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-8">
              {activeSession
                ? 'No messages yet. Say hello to start.'
                : labels.noActiveSessionFiles}
            </p>
          ) : (
            chatMessages.map((msg) => {
              const isSelf = msg.senderPeerId === selfPeerId;
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isSelf ? 'items-end' : 'items-start'}`}
                >
                  <div className="text-[11px] text-slate-400 mb-0.5 tabular-nums">
                    {msg.senderName} ·{' '}
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                  <div
                    className={`px-3 py-2 rounded-lg text-xs max-w-[85%] break-words ${
                      isSelf
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 text-slate-900 border border-slate-200'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <form onSubmit={handleChatSubmit} className="pt-3 border-t border-slate-100 flex gap-2">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            disabled={!activeSession}
            placeholder={labels.chatPlaceholder}
            className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 disabled:bg-slate-50"
          />
          <button
            type="submit"
            disabled={!activeSession || !chatInput.trim()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
          >
            <Send className="w-3.5 h-3.5" />
            {labels.sendBtn}
          </button>
        </form>
      </div>
    </div>
  );
};
