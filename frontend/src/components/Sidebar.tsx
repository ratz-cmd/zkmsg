import React, { useState } from 'react';
import { Search, Menu, Plus, QrCode, ShieldAlert } from 'lucide-react';

export interface Chat {
  id: string;
  name: string;
  avatarColor: string;
  lastMessage: string;
  timestamp: Date;
  unreadCount: number;
  isOnline: boolean;
}

interface SidebarProps {
  chats: Chat[];
  activeChatId: string | null;
  onSelectChat: (chatId: string) => void;
  onAddContactClick: () => void;
  onLockSession: () => void;
}

export function Sidebar({
  chats,
  activeChatId,
  onSelectChat,
  onAddContactClick,
  onLockSession,
}: SidebarProps): React.JSX.Element {
  const [searchQuery, setSearchQuery] = useState('');
  const [showMenu, setShowMenu] = useState(false);

  const filteredChats = chats.filter(chat =>
    chat.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    chat.lastMessage.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getInitials = (name: string) => {
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <aside className="w-80 h-full bg-[#0e1621] border-r border-[#101921] flex flex-col relative select-none">
      {/* Sidebar Header */}
      <div className="h-14 flex items-center px-4 space-x-3 bg-[#0e1621] z-20">
        <div className="relative">
          <button 
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 hover:bg-[#202b36] rounded-full text-gray-400 hover:text-white transition-colors"
          >
            <Menu size={20} />
          </button>
          
          {/* Popover Menu - Telegram style with Apple Cyber touches */}
          {showMenu && (
            <div className="absolute left-0 mt-2 w-56 bg-[#182533] border border-[#202b36] rounded-xl shadow-2xl py-1.5 z-30 animate-in fade-in slide-in-from-top-2 duration-150">
              <button 
                onClick={() => { onAddContactClick(); setShowMenu(false); }}
                className="w-full px-4 py-2.5 text-left text-sm text-gray-200 hover:bg-[#2b5278] hover:text-white flex items-center space-x-3 transition-colors"
              >
                <QrCode size={16} />
                <span>Scanner QR Bundle (X3DH)</span>
              </button>
              <div className="border-t border-[#202b36] my-1" />
              <button 
                onClick={() => { onLockSession(); setShowMenu(false); }}
                className="w-full px-4 py-2.5 text-left text-sm text-red-400 hover:bg-red-500/10 flex items-center space-x-3 transition-colors"
              >
                <ShieldAlert size={16} />
                <span>Verrouiller la session</span>
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 relative">
          <Search className="absolute left-3 top-2.5 text-gray-500" size={15} />
          <input
            type="text"
            placeholder="Recherche"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#24303f] text-gray-200 rounded-full pl-9 pr-4 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#5288c1] placeholder-gray-500"
          />
        </div>

        <button 
          onClick={onAddContactClick}
          className="p-2 bg-[#2b5278] hover:bg-[#346290] rounded-full text-white transition-all transform hover:scale-105 shadow-md"
          title="Ajouter un contact via QR Code"
        >
          <Plus size={18} />
        </button>
      </div>

      {/* Chat List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#101921]/30">
        {filteredChats.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">
            Aucune conversation trouvée
          </div>
        ) : (
          filteredChats.map((chat) => {
            const isSelected = activeChatId === chat.id;
            return (
              <div
                key={chat.id}
                onClick={() => onSelectChat(chat.id)}
                className={`flex items-center px-4 py-3 cursor-pointer transition-colors relative
                  ${isSelected ? 'bg-[#2b5278] text-white' : 'hover:bg-[#202b36] text-gray-300'}
                `}
              >
                {/* Avatar with initials */}
                <div 
                  className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-white shadow-inner relative flex-shrink-0"
                  style={{ backgroundColor: chat.avatarColor }}
                >
                  {getInitials(chat.name)}
                  {chat.isOnline && (
                    <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-[#0e1621] rounded-full" />
                  )}
                </div>

                {/* Details */}
                <div className="ml-3 flex-1 overflow-hidden">
                  <div className="flex justify-between items-baseline mb-0.5">
                    <h3 className={`font-semibold text-sm truncate ${isSelected ? 'text-white' : 'text-gray-100'}`}>
                      {chat.name}
                    </h3>
                    <span className={`text-[11px] ${isSelected ? 'text-gray-200' : 'text-gray-500'}`}>
                      {formatTime(chat.timestamp)}
                    </span>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <p className={`text-xs truncate max-w-[180px] ${isSelected ? 'text-gray-200' : 'text-gray-400'}`}>
                      {chat.lastMessage}
                    </p>
                    
                    {chat.unreadCount > 0 && !isSelected && (
                      <span className="bg-[#5288c1] text-white text-[10px] font-bold px-2 py-0.5 rounded-full min-w-5 text-center shadow-sm">
                        {chat.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
