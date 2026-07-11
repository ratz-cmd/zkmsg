import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Sidebar, type Chat } from '../components/Sidebar';
import { ChatArea } from '../components/ChatArea';
import { type Message } from '../components/MessageBubble';
import { QRScanner } from '../components/QRScanner';
import { WebSocketManager } from '../network/websocketManager';
import { X, QrCode } from 'lucide-react';
import { bytesToHex } from '@noble/hashes/utils';

export function ChatPage(): React.JSX.Element {
  const { accountId, identity, lock } = useAuth();
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [myQrBundle, setMyQrBundle] = useState<string | null>(null);

  // Chats list (empty by default, populated dynamically as we add or receive)
  const [chats, setChats] = useState<Chat[]>([]);

  // Messages map indexed by chatId
  const [messagesMap, setMessagesMap] = useState<Record<string, Message[]>>({});

  // WebSocket Manager reference
  const wsManagerRef = useRef<WebSocketManager | null>(null);

  // Initialize Network Connection
  useEffect(() => {
    if (!accountId) return;

    // Incoming message handler from network
    const handleIncomingMessage = (senderId: string, text: string, timestamp: Date) => {
      // Avoid self-reflection if the router loops (should not happen, but safe)
      if (senderId === accountId) return;

      setChats(prev => {
        const exists = prev.some(c => c.id === senderId);
        if (!exists) {
          const newChat: Chat = {
            id: senderId,
            name: `${senderId.slice(0, 8)}…${senderId.slice(-6)}`,
            avatarColor: '#a370f0',
            lastMessage: text,
            timestamp,
            unreadCount: 1,
            isOnline: true
          };
          return [newChat, ...prev];
        }
        return prev.map(chat => {
          if (chat.id === senderId) {
            return {
              ...chat,
              lastMessage: text,
              timestamp,
              unreadCount: activeChatId === senderId ? 0 : chat.unreadCount + 1
            };
          }
          return chat;
        });
      });

      setMessagesMap(prev => ({
        ...prev,
        [senderId]: [...(prev[senderId] || []), {
          id: Math.random().toString(),
          senderId,
          text,
          timestamp,
          isSelf: false,
          status: 'read'
        }]
      }));
    };

    const manager = new WebSocketManager(accountId, handleIncomingMessage);
    manager.connect();
    wsManagerRef.current = manager;

    return () => {
      manager.disconnect();
      wsManagerRef.current = null;
    };
  }, [accountId, activeChatId]);

  const activeChat = chats.find(c => c.id === activeChatId) || null;
  const activeMessages = activeChatId ? (messagesMap[activeChatId] || []) : [];

  const handleSendMessage = (text: string, file?: File) => {
    if (!activeChatId || !accountId) return;

    // 1. Dispatch over WebSocket Network
    if (wsManagerRef.current) {
      try {
        wsManagerRef.current.sendMessage(activeChatId, text);
      } catch (err) {
        console.error("Network send failed:", err);
        alert("Erreur réseau : " + (err instanceof Error ? err.message : String(err)));
        return;
      }
    }

    // 2. Append locally
    const newMessage: Message = {
      id: Math.random().toString(),
      senderId: 'self',
      text: text || undefined,
      attachment: file ? {
        filename: file.name,
        size: file.size,
        mime_type: file.type || 'application/octet-stream',
        blob_id: 'mock_blob_' + Math.random().toString(36).substring(7)
      } : undefined,
      timestamp: new Date(),
      isSelf: true,
      status: 'sent'
    };

    setMessagesMap(prev => ({
      ...prev,
      [activeChatId]: [...(prev[activeChatId] || []), newMessage]
    }));

    setChats(prev => prev.map(chat => {
      if (chat.id === activeChatId) {
        return {
          ...chat,
          lastMessage: file ? `Fichier : ${file.name}` : text,
          timestamp: new Date()
        };
      }
      return chat;
    }));
  };

  const handleClearHistory = () => {
    if (!activeChatId) return;
    setMessagesMap(prev => ({
      ...prev,
      [activeChatId]: []
    }));
    setChats(prev => prev.map(chat => {
      if (chat.id === activeChatId) {
        return { ...chat, lastMessage: 'Historique effacé', timestamp: new Date() };
      }
      return chat;
    }));
  };

  const handleScanSuccess = (payload: string) => {
    setShowAddContactModal(false);
    
    // Parse simulated Base58 bundle (representing target Account ID)
    // QR payload can be target's Account ID directly or an encoded X3DH bundle
    const targetAccountId = payload.startsWith('zkmsg-bundle-')
      ? payload.split('-')[2] // extract mock ID
      : payload;

    if (targetAccountId === accountId) {
      alert("Vous ne pouvez pas vous ajouter vous-même.");
      return;
    }

    setChats(prev => {
      const exists = prev.some(c => c.id === targetAccountId);
      if (exists) return prev;
      
      const newChat: Chat = {
        id: targetAccountId,
        name: `${targetAccountId.slice(0, 8)}…${targetAccountId.slice(-6)}`,
        avatarColor: '#5288c1',
        lastMessage: 'Bundle X3DH importé hors-ligne',
        timestamp: new Date(),
        unreadCount: 0,
        isOnline: true
      };
      return [newChat, ...prev];
    });

    setActiveChatId(targetAccountId);
  };

  const showMyBundle = () => {
    if (accountId) {
      // In prod, this would serialize the full public keys (X3DH Bundle)
      // For now we encode the Account ID to demonstrate sharing
      setMyQrBundle(accountId);
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0e1621] text-white">
      {/* Sidebar Panel */}
      <Sidebar
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={(id) => {
          setActiveChatId(id);
          setChats(prev => prev.map(c => c.id === id ? { ...c, unreadCount: 0 } : c));
        }}
        onAddContactClick={() => setShowAddContactModal(true)}
        onLockSession={lock}
      />

      {/* Chat area */}
      {activeChat ? (
        <ChatArea
          chatName={activeChat.name}
          isOnline={activeChat.isOnline}
          avatarColor={activeChat.avatarColor}
          messages={activeMessages}
          onSendMessage={handleSendMessage}
          onClearHistory={handleClearHistory}
        />
      ) : (
        <div className="flex-1 h-full bg-[#0e1621] flex flex-col items-center justify-center text-gray-500 space-y-4">
          <div className="w-16 h-16 rounded-full bg-[#17212b] border border-[#202b36] flex items-center justify-center text-gray-400">
            <QrCode size={32} />
          </div>
          <div className="text-center max-w-md px-6">
            <h3 className="text-gray-300 font-semibold text-sm">Prêt pour la communication sécurisée</h3>
            <p className="text-xs text-gray-500 mt-2">
              Votre identifiant de compte est : <span className="font-mono text-gray-400 select-all block mt-1">{accountId}</span>
            </p>
          </div>
          <button
            onClick={() => setShowAddContactModal(true)}
            className="px-4 py-2.5 bg-[#2b5278] hover:bg-[#346290] text-white rounded-xl text-sm font-medium transition-colors"
          >
            Importer / Partager QR Code
          </button>
        </div>
      )}

      {/* Add Contact Modal */}
      {showAddContactModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="relative w-full max-w-md bg-[#17212b] border border-[#24303f] rounded-3xl p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <button 
              onClick={() => { setShowAddContactModal(false); setMyQrBundle(null); }}
              className="absolute right-4 top-4 p-1.5 bg-[#202b36] hover:bg-[#2c3848] rounded-full text-gray-400 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
            
            {myQrBundle ? (
              <div className="flex flex-col items-center text-center space-y-4 pt-4">
                <h3 className="text-lg font-semibold text-gray-100">Partager mon identité</h3>
                <p className="text-xs text-gray-400 max-w-xs">
                  Faites scanner ce code par votre contact pour qu'il puisse dériver les clés partagées et vous envoyer un message chiffré.
                </p>
                {/* Simulated QR Code containing Account ID */}
                <div className="p-4 bg-white rounded-2xl flex flex-col items-center justify-center">
                  <QrCode size={180} className="text-black" />
                  <span className="text-[10px] font-mono text-gray-500 select-all truncate max-w-[200px] mt-2">{myQrBundle}</span>
                </div>
                
                {identity && (
                  <div className="w-full text-left bg-black/20 p-3 rounded-xl border border-white/5 space-y-1.5">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-gray-500">Identity (Ed25519)</span>
                      <span className="font-mono text-gray-300 truncate max-w-[150px]">{bytesToHex(identity.identityPublicKey)}</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-gray-500">PreKey (X25519)</span>
                      <span className="font-mono text-gray-300 truncate max-w-[150px]">{bytesToHex(identity.x25519PublicKey)}</span>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => setMyQrBundle(null)}
                  className="mt-2 text-sm text-[#5288c1] hover:underline"
                >
                  Retour au scan
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                <QRScanner onScanSuccess={handleScanSuccess} />
                <div className="text-center">
                  <button 
                    onClick={showMyBundle}
                    className="text-sm text-[#5288c1] hover:underline hover:text-blue-300 transition-colors font-medium"
                  >
                    Afficher mon QR Code de contact
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
