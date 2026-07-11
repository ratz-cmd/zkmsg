import React from 'react';
import { Check, CheckCheck, FileText, Download } from 'lucide-react';

export interface Attachment {
  filename: string;
  size: number;
  mime_type: string;
  blob_id: string;
}

export interface Message {
  id: string;
  senderId: string;
  text?: string;
  attachment?: Attachment;
  timestamp: Date;
  isSelf: boolean;
  status: 'sent' | 'delivered' | 'read';
}

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps): React.JSX.Element {
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatSize = (bytes: number) => {
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  };

  const renderStatus = () => {
    if (!message.isSelf) return null;
    switch (message.status) {
      case 'sent':
        return <Check size={14} className="text-gray-400" />;
      case 'delivered':
        return <CheckCheck size={14} className="text-gray-400" />;
      case 'read':
        return <CheckCheck size={14} className="text-[#5288c1] dark:text-[#2f6ea5]" />;
      default:
        return null;
    }
  };

  return (
    <div className={`flex ${message.isSelf ? 'justify-end' : 'justify-start'} w-full mb-2 px-4`}>
      <div
        className={`max-w-[70%] rounded-2xl px-3.5 py-2.5 shadow-md relative group select-text
          ${message.isSelf 
            ? 'bg-[#2b5278] text-white rounded-br-none' 
            : 'bg-[#182533] text-gray-100 border border-[#101921]/50 rounded-bl-none'
          }
        `}
      >
        {/* Attachment preview if present */}
        {message.attachment && (
          <div className="flex items-center space-x-3 mb-2 p-2 rounded-xl bg-black/15 border border-white/5">
            <div className="p-2.5 bg-white/10 dark:bg-black/25 rounded-lg text-white">
              <FileText size={22} />
            </div>
            <div className="flex-1 overflow-hidden min-w-[120px]">
              <p className="text-sm font-medium truncate text-white">{message.attachment.filename}</p>
              <p className="text-xs text-gray-300">{formatSize(message.attachment.size)}</p>
            </div>
            <button 
              className="p-1.5 hover:bg-white/15 dark:hover:bg-black/30 rounded-full transition-colors text-white"
              title="Télécharger la pièce jointe chiffrée"
            >
              <Download size={16} />
            </button>
          </div>
        )}

        {/* Text message content */}
        {message.text && (
          <p className="text-[15px] leading-[1.4] break-words whitespace-pre-wrap pr-12 pb-1">
            {message.text}
          </p>
        )}

        {/* Telegram-style integrated time and status badge */}
        <div 
          className={`absolute bottom-1 right-2 flex items-center space-x-1 select-none pointer-events-none
            ${message.text ? '' : 'bg-black/20 px-1.5 py-0.5 rounded-full mt-1 relative bottom-0 right-0 self-end'}
          `}
        >
          <span className="text-[10px] text-gray-400/80 font-normal">
            {formatTime(message.timestamp)}
          </span>
          {renderStatus()}
        </div>
      </div>
    </div>
  );
}
