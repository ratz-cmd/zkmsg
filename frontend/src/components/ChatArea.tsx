import React, { useState, useRef, useEffect } from 'react';
import { Paperclip, Send, User, Trash2, ShieldAlert } from 'lucide-react';
import { MessageBubble, type Message } from './MessageBubble';
import { useVirtualizer } from '@tanstack/react-virtual';

interface ChatAreaProps {
  chatName: string;
  isOnline: boolean;
  avatarColor: string;
  messages: Message[];
  onSendMessage: (text: string, file?: File) => void;
  onClearHistory: () => void;
}

export function ChatArea({
  chatName,
  isOnline,
  avatarColor,
  messages,
  onSendMessage,
  onClearHistory,
}: ChatAreaProps): React.JSX.Element {
  const [text, setText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Virtualizer strict limit to prevent RAM leaks (DOM virtualization)
  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 70, // Average size of a text message bubble
    overscan: 5, // keep at most 5 items rendered outside screen viewport bounds
  });

  // Scroll to bottom on new messages
  useEffect(() => {
    if (parentRef.current) {
      parentRef.current.scrollTop = parentRef.current.scrollHeight;
    }
  }, [messages.length]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() && !selectedFile) return;
    onSendMessage(text, selectedFile || undefined);
    setText('');
    setSelectedFile(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const getInitials = (name: string) => {
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <main className="flex-1 h-full bg-[#0e1621] flex flex-col relative overflow-hidden select-none">
      {/* Header */}
      <header className="h-14 border-b border-[#101921]/60 bg-[#17212b] flex items-center justify-between px-6 z-10 shadow-sm">
        <div className="flex items-center space-x-3">
          <div 
            className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shadow-inner"
            style={{ backgroundColor: avatarColor }}
          >
            {getInitials(chatName)}
          </div>
          <div>
            <h2 className="text-gray-100 font-semibold text-sm leading-tight">{chatName}</h2>
            <span className={`text-[11px] ${isOnline ? 'text-[#5288c1]' : 'text-gray-500'}`}>
              {isOnline ? 'en ligne' : 'hors ligne'}
            </span>
          </div>
        </div>

        {/* Security badge and delete option */}
        <div className="flex items-center space-x-2">
          <span 
            className="flex items-center space-x-1.5 px-3 py-1 bg-[#2b5278]/20 border border-[#2b5278]/40 rounded-full text-xs text-[#5288c1]"
            title="Session chiffrée par Double Ratchet (Perfect Forward Secrecy)"
          >
            <ShieldAlert size={12} />
            <span>Double Ratchet Actif</span>
          </span>
          <button 
            onClick={onClearHistory}
            className="p-2 hover:bg-red-500/10 hover:text-red-400 rounded-full text-gray-400 transition-colors"
            title="Effacer la conversation (Suppression atomique SQLCipher)"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      {/* Messages Window (Virtualized Container) */}
      <div 
        ref={parentRef} 
        className="flex-1 overflow-y-auto bg-[#0e1621] relative py-4 scrollbar-thin"
        style={{ contentVisibility: 'auto' }}
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-2">
            <div className="p-4 bg-[#17212b] rounded-2xl border border-[#202b36] shadow-md text-center max-w-sm">
              <p className="text-sm font-semibold text-gray-300">Aucun message pour l'instant</p>
              <p className="text-xs text-gray-500 mt-1">
                L'échange de clés X3DH est validé. Envoyez un message pour démarrer le chiffrement de bout en bout.
              </p>
            </div>
          </div>
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const message = messages[virtualRow.index];
              return (
                <div
                  key={message.id}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className="py-1"
                >
                  <MessageBubble message={message} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Attachments Tray (Pre-send preview) */}
      {selectedFile && (
        <div className="px-6 py-2 bg-[#17212b] border-t border-[#101921] flex items-center justify-between animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center space-x-2 text-sm text-gray-300">
            <span className="font-semibold">Fichier prêt :</span>
            <span className="truncate max-w-[200px] font-mono text-xs">{selectedFile.name}</span>
            <span className="text-xs text-gray-500">({(selectedFile.size / 1024).toFixed(1)} KB)</span>
          </div>
          <button 
            onClick={() => setSelectedFile(null)}
            className="text-xs text-red-400 hover:text-red-300 hover:underline"
          >
            Annuler
          </button>
        </div>
      )}

      {/* Input Area */}
      <div className="p-3.5 bg-[#17212b] border-t border-[#101921]/60">
        <form onSubmit={handleSend} className="flex items-center space-x-2 max-w-4xl mx-auto">
          {/* File Attach Button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 hover:bg-[#24303f] rounded-full text-gray-400 hover:text-white transition-colors flex-shrink-0"
            title="Joindre un fichier (chiffrement symétrique éphémère)"
          >
            <Paperclip size={18} />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
          />

          {/* Text Input */}
          <input
            type="text"
            placeholder="Écrire un message..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="flex-1 bg-[#24303f] text-gray-100 placeholder-gray-500 rounded-2xl px-4 py-2.5 text-[15px] focus:outline-none focus:ring-1 focus:ring-[#5288c1] shadow-inner"
          />

          {/* Send Button */}
          <button
            type="submit"
            disabled={!text.trim() && !selectedFile}
            className={`p-2.5 rounded-full flex-shrink-0 transition-all shadow-md
              ${(!text.trim() && !selectedFile)
                ? 'bg-gray-700/30 text-gray-500 cursor-not-allowed'
                : 'bg-[#2b5278] hover:bg-[#346290] text-white hover:scale-105 active:scale-95'
              }
            `}
          >
            <Send size={18} />
          </button>
        </form>
      </div>
    </main>
  );
}
