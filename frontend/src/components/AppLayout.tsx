import React, { useState, useRef } from 'react';
import { Search, Edit, FileText, Download, User } from 'lucide-react';
import { sanitizeFilename } from '../crypto/fileCrypto';
import { useVirtualizer } from '@tanstack/react-virtual';

interface Message {
  id: string;
  senderId: string;
  text?: string;
  attachment?: {
    filename: string;
    size: number;
    mime_type: string;
    blob_id: string;
  };
  timestamp: Date;
  isSelf: boolean;
}

export function AppLayout() {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', senderId: 'peer', text: 'Hello, is this channel secure?', timestamp: new Date(), isSelf: false },
    { id: '2', senderId: 'self', text: 'Yes, Double Ratchet is active.', timestamp: new Date(), isSelf: true },
    {
      id: '3', senderId: 'peer', timestamp: new Date(), isSelf: false,
      attachment: { filename: 'architecture_v2.pdf', size: 2048000, mime_type: 'application/pdf', blob_id: 'randomBlob123' }
    }
  ]);

  const [input, setInput] = useState('');
  const parentRef = useRef<HTMLDivElement>(null);

  // Virtualizer strict limit to mitigate RAM leaks.
  // Renders ONLY the items currently visible in the scroll window + an overscan of 5.
  // The V8 GC will immediately sweep strings out of memory once they scroll out of the virtualized DOM.
  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80, // Estimated pixel height per message
    overscan: 5, // Maximum 5 items kept in DOM outside viewport
  });

  const formatSize = (bytes: number) => {
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const safeName = sanitizeFilename(file.name);
      alert(`File dropped (sanitized): ${safeName}\nSize: ${formatSize(file.size)}`);
    }
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };

  return (
    <div className="flex h-screen w-full bg-apple-bg dark:bg-apple-darkBg text-apple-text dark:text-apple-darkText overflow-hidden font-sans">
      
      {/* Sidebar */}
      <aside className="w-80 border-r border-apple-border dark:border-apple-darkBorder bg-apple-sidebar/80 dark:bg-apple-darkSidebar/80 backdrop-blur-apple flex flex-col z-10">
        <div className="h-16 flex items-center justify-between px-4 border-b border-apple-border dark:border-apple-darkBorder">
          <h2 className="font-semibold text-lg">Chats</h2>
          <button className="p-2 text-apple-blue dark:text-apple-darkBlue hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors">
            <Edit size={18} />
          </button>
        </div>
        
        <div className="p-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
            <input type="text" placeholder="Search" className="w-full bg-gray-200/50 dark:bg-gray-800/50 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-apple-blue" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Mock Conversation Item */}
          <div className="flex items-center px-4 py-3 hover:bg-apple-blue/10 cursor-pointer transition-colors">
            <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-purple-500 to-apple-blue flex items-center justify-center text-white font-bold">
              <User size={24} />
            </div>
            <div className="ml-3 flex-1 overflow-hidden">
              <div className="flex justify-between items-baseline">
                <h3 className="font-medium truncate">Alice (ZK)</h3>
                <span className="text-xs text-gray-500">10:42 AM</span>
              </div>
              <p className="text-sm text-gray-500 truncate">Attachment received</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col relative" onDrop={handleDrop} onDragOver={handleDragOver}>
        <header className="h-16 border-b border-apple-border dark:border-apple-darkBorder bg-white/50 dark:bg-black/50 backdrop-blur-apple flex items-center px-6 z-10">
          <h2 className="font-semibold text-lg">Alice (ZK)</h2>
        </header>

        {/* DOM Virtualization Container */}
        <div ref={parentRef} className="flex-1 overflow-y-auto p-6 relative">
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const msg = messages[virtualRow.index];
              return (
                <div
                  key={msg.id}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className={`flex ${msg.isSelf ? 'justify-end' : 'justify-start'} py-2`}
                >
                  <div className={`max-w-[70%] rounded-2xl px-4 py-2 shadow-sm ${msg.isSelf ? 'bg-apple-blue dark:bg-apple-darkBlue text-white rounded-br-none' : 'bg-white dark:bg-gray-800 border border-apple-border/50 dark:border-apple-darkBorder/50 rounded-bl-none'}`}>
                    
                    {msg.text && (
                      <p className="text-[15px] leading-relaxed break-words">{msg.text}</p>
                    )}
                    
                    {msg.attachment && (
                      <div className={`flex items-center space-x-3 mt-1 p-2 rounded-xl ${msg.isSelf ? 'bg-black/10' : 'bg-gray-100 dark:bg-gray-700'}`}>
                        <div className="p-2 bg-white/20 dark:bg-black/20 rounded-lg">
                          <FileText size={24} />
                        </div>
                        <div className="flex-1 overflow-hidden">
                          <p className="text-sm font-medium truncate">{msg.attachment.filename}</p>
                          <p className="text-xs opacity-70">{formatSize(msg.attachment.size)}</p>
                        </div>
                        <button className="p-2 hover:bg-white/20 dark:hover:bg-black/20 rounded-full transition-colors">
                          <Download size={18} />
                        </button>
                      </div>
                    )}

                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-4 bg-white/50 dark:bg-black/50 backdrop-blur-apple border-t border-apple-border dark:border-apple-darkBorder">
          <div className="relative">
            <input 
              type="text" placeholder="iMessage (ZK)..." value={input} onChange={(e) => setInput(e.target.value)}
              className="w-full bg-white dark:bg-gray-800 border border-apple-border dark:border-apple-darkBorder rounded-full pl-4 pr-12 py-2 text-[15px] focus:outline-none focus:ring-2 focus:ring-apple-blue shadow-sm"
            />
            <button className="absolute right-2 top-1.5 p-1.5 bg-apple-blue text-white rounded-full hover:bg-apple-blue/90 transition-colors">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
