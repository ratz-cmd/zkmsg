import { invoke } from '@tauri-apps/api/core';
import { useState, useEffect } from 'react';

export interface MessageRecord {
  id: string;
  conversation_id: string;
  sender_id: string;
  text_content?: string;
  attachment_json?: string;
  timestamp: number;
  is_self: boolean;
}

/**
 * Custom hook for Just-In-Time (JIT) message loading.
 * Ensures data is only held in RAM while the chat view is mounted.
 * NO global state (Zustand/Redux) is used to prevent RAM dumps.
 */
export function useChatDatabase(conversationId: string | null, limit: number = 50) {
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    if (!conversationId) {
      setMessages([]);
      return;
    }

    async function fetchMessages() {
      setLoading(true);
      try {
        // Tauri IPC call: asks Rust to query SQLCipher and return exact page
        const msgs = await invoke<MessageRecord[]>('load_messages', { 
          conversationId, 
          limit, 
          offset: 0 
        });
        
        if (isMounted) {
          setMessages(msgs);
        }
      } catch (err) {
        console.error("Failed to load JIT messages:", err);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchMessages();

    // CLEANUP: Zeroing the JS memory state when unmounted or switching chats
    // The V8 Garbage Collector will aggressively free this since there are no global references
    return () => {
      isMounted = false;
      setMessages([]);
    };
  }, [conversationId, limit]);

  return { messages, loading };
}

/**
 * Persists the Double Ratchet state atomically alongside a new message.
 * This is the `persist` callback passed into `DoubleRatchet.encrypt/decrypt`.
 */
export async function persistRatchetAndMessage(
  peerId: string,
  stateJson: string, // Requires a serializeRatchetState() function to extract buffers to Hex/B64
  message: MessageRecord
): Promise<void> {
  // IPC Call blocks the Ratchet execution until SQLCipher confirms the disk write
  await invoke('save_ratchet_and_message', {
    peerId,
    ratchetStateJson: stateJson,
    message
  });
}

/**
 * Unlocks the SQLCipher database. Called once on LockScreen success.
 * Key must be derived via Argon2id (Phase 1) and passed here.
 */
export async function unlockDatabase(hexKey: string): Promise<void> {
  await invoke('unlock_database', { hexKey });
}
