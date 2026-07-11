import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Sidebar, type Chat } from '../components/Sidebar';
import { ChatArea } from '../components/ChatArea';
import { type Message } from '../components/MessageBubble';
import { QRScanner } from '../components/QRScanner';
import { X, QrCode } from 'lucide-react';

export function ChatPage(): React.JSX.Element {
  const { accountId, lock } = useAuth();
  const [activeChatId, setActiveChatId] = useState<string | null>('1');
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [myQrBundle, setMyQrBundle] = useState<string | null>(null);

  // Mock Chats
  const [chats, setChats] = useState<Chat[]>([
    {
      id: '1',
      name: 'Alice (Secured)',
      avatarColor: '#5288c1',
      lastMessage: 'Le ratchet s\'est synchronisé avec succès.',
      timestamp: new Date(Date.now() - 1000 * 60 * 5),
      unreadCount: 0,
      isOnline: true,
    },
    {
      id: '2',
      name: 'Bob (Zero-Knowledge)',
      avatarColor: '#a370f0',
      lastMessage: 'Envoie-moi le document chiffré.',
      timestamp: new Date(Date.now() - 1000 * 60 * 30),
      unreadCount: 2,
      isOnline: false,
    },
    {
      id: '3',
      name: 'Carol (Double Ratchet)',
      avatarColor: '#22c55e',
      lastMessage: 'Fichier reçu : architecture.pdf',
      timestamp: new Date(Date.now() - 1000 * 60 * 120),
      unreadCount: 0,
      isOnline: true,
    }
  ]);

  // Mock Messages indexed by chatId
  const [messagesMap, setMessagesMap] = useState<Record<string, Message[]>>({
    '1': [
      {
        id: 'm1',
        senderId: 'peer',
        text: 'Salut ! Notre canal de communication est-il sécurisé ?',
        timestamp: new Date(Date.now() - 1000 * 60 * 20),
        isSelf: false,
        status: 'read'
      },
      {
        id: 'm2',
        senderId: 'self',
        text: 'Oui, nous utilisons X3DH pour l\'échange initial de clés hors-ligne et Double Ratchet pour le chiffrement à la volée.',
        timestamp: new Date(Date.now() - 1000 * 60 * 18),
        isSelf: true,
        status: 'read'
      },
      {
        id: 'm3',
        senderId: 'peer',
        text: 'Génial. Pas de clés stockées sur le serveur Go ?',
        timestamp: new Date(Date.now() - 1000 * 60 * 10),
        isSelf: false,
        status: 'read'
      },
      {
        id: 'm4',
        senderId: 'self',
        text: 'Absolument rien. Le serveur ne voit que des enveloppes opaques de livraison.',
        timestamp: new Date(Date.now() - 1000 * 60 * 8),
        isSelf: true,
        status: 'read'
      },
      {
        id: 'm5',
        senderId: 'peer',
        text: 'Le ratchet s\'est synchronisé avec succès.',
        timestamp: new Date(Date.now() - 1000 * 60 * 5),
        isSelf: false,
        status: 'read'
      }
    ],
    '2': [
      {
        id: 'm6',
        senderId: 'peer',
        text: 'Salut Bob. J\'ai implémenté le streaming cryptographique pour les fichiers lourds.',
        timestamp: new Date(Date.now() - 1000 * 60 * 40),
        isSelf: false,
        status: 'read'
      },
      {
        id: 'm7',
        senderId: 'self',
        text: 'Top ! Faisons un test avec une pièce jointe.',
        timestamp: new Date(Date.now() - 1000 * 60 * 35),
        isSelf: true,
        status: 'read'
      },
      {
        id: 'm8',
        senderId: 'peer',
        text: 'Envoie-moi le document chiffré.',
        timestamp: new Date(Date.now() - 1000 * 60 * 30),
        isSelf: false,
        status: 'delivered'
      }
    ],
    '3': [
      {
        id: 'm9',
        senderId: 'self',
        text: 'Voici l\'architecture mise à jour.',
        timestamp: new Date(Date.now() - 1000 * 60 * 130),
        isSelf: true,
        status: 'read'
      },
      {
        id: 'm10',
        senderId: 'self',
        attachment: {
          filename: 'architecture_zkmsg_v2.pdf',
          size: 4194304, // 4 MB
          mime_type: 'application/pdf',
          blob_id: 'blob_992a0134f'
        },
        timestamp: new Date(Date.now() - 1000 * 60 * 125),
        isSelf: true,
        status: 'read'
      },
      {
        id: 'm11',
        senderId: 'peer',
        text: 'Fichier reçu : architecture.pdf',
        timestamp: new Date(Date.now() - 1000 * 60 * 120),
        isSelf: false,
        status: 'read'
      }
    ]
  });

  const activeChat = chats.find(c => c.id === activeChatId) || null;
  const activeMessages = activeChatId ? (messagesMap[activeChatId] || []) : [];

  const handleSendMessage = (text: string, file?: File) => {
    if (!activeChatId) return;

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

    // Update messages
    setMessagesMap(prev => ({
      ...prev,
      [activeChatId]: [...(prev[activeChatId] || []), newMessage]
    }));

    // Update last message in chat list
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

    // Mock automatic reply for active design feedback
    setTimeout(() => {
      const replyMessage: Message = {
        id: Math.random().toString(),
        senderId: 'peer',
        text: `[Mock ZK Auto-Reply] Message reçu de manière sécurisée sur ${activeChat?.name}`,
        timestamp: new Date(),
        isSelf: false,
        status: 'read'
      };

      setMessagesMap(prev => ({
        ...prev,
        [activeChatId]: [...(prev[activeChatId] || []), replyMessage]
      }));

      setChats(prev => prev.map(chat => {
        if (chat.id === activeChatId) {
          return {
            ...chat,
            lastMessage: replyMessage.text || '',
            timestamp: new Date()
          };
        }
        return chat;
      }));
    }, 1500);
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
    // Parse simulated Base58 bundle (mock behavior)
    const newChatId = (chats.length + 1).toString();
    const newChat: Chat = {
      id: newChatId,
      name: `Contact ${payload.slice(0, 8)}...`,
      avatarColor: '#' + Math.floor(Math.random()*16777215).toString(16),
      lastMessage: 'Bundle X3DH importé hors-ligne',
      timestamp: new Date(),
      unreadCount: 0,
      isOnline: true
    };

    setChats(prev => [newChat, ...prev]);
    setMessagesMap(prev => ({
      ...prev,
      [newChatId]: [{
        id: Math.random().toString(),
        senderId: 'peer',
        text: `Canal sécurisé ouvert. Bundle importé : ${payload}`,
        timestamp: new Date(),
        isSelf: false,
        status: 'read'
      }]
    }));
    setActiveChatId(newChatId);
  };

  // Generate a mock base58 payload for offline share
  const showMyBundle = () => {
    if (accountId) {
      setMyQrBundle(`zkmsg-bundle-${accountId}-mockpayload-base58string`);
    } else {
      setMyQrBundle(`zkmsg-bundle-anonymous-mockpayload-base58string`);
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
          // Reset unread count
          setChats(prev => prev.map(c => c.id === id ? { ...c, unreadCount: 0 } : c));
        }}
        onAddContactClick={() => setShowAddContactModal(true)}
        onLockSession={lock}
      />

      {/* Chat panel */}
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
          <p className="text-sm">Sélectionnez une conversation ou importez un contact.</p>
          <button
            onClick={() => setShowAddContactModal(true)}
            className="px-4 py-2 bg-[#2b5278] hover:bg-[#346290] text-white rounded-lg text-sm font-medium transition-colors"
          >
            Scanner un QR Code
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
                <h3 className="text-lg font-semibold text-gray-100">Votre QR Code d'identité</h3>
                <p className="text-xs text-gray-400 max-w-xs">
                  Partagez ce QR Code hors-ligne. Il contient votre Account ID, votre clé d'identité et votre pré-clé signée.
                </p>
                {/* Simulated QR Code */}
                <div className="p-4 bg-white rounded-2xl flex items-center justify-center">
                  <div className="w-48 h-48 bg-gray-200 flex flex-col items-center justify-center text-black border border-gray-300">
                    <QrCode size={120} className="text-black mb-1" />
                    <span className="text-[10px] font-mono select-all truncate max-w-[160px]">{myQrBundle}</span>
                  </div>
                </div>
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
                    Montrer mon QR Code d'identité
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
