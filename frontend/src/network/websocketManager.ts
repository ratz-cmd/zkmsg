import { sha256 } from '@noble/hashes/sha256';
import bs58 from 'bs58';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8080';
const WS_BASE_URL = import.meta.env.VITE_WS_URL || 'ws://127.0.0.1:8080';

export interface Envelope {
  version: number;
  type: number;
  recipient: Uint8Array; // 32 bytes
  timestamp: bigint;     // Unix nanoseconds
  payload: Uint8Array;   // Opaque data
}

// Helpers for hex conversion
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Check leading zero bits for PoW difficulty validation
function hasLeadingZeroBits(hash: Uint8Array, difficulty: number): boolean {
  if (difficulty <= 0) return true;
  const fullBytes = Math.floor(difficulty / 8);
  const remainingBits = difficulty % 8;

  for (let i = 0; i < fullBytes; i++) {
    if (hash[i] !== 0) return false;
  }

  if (remainingBits > 0) {
    const mask = 0xFF << (8 - remainingBits);
    if ((hash[fullBytes] & mask) !== 0) {
      return false;
    }
  }
  return true;
}

// PoW Solver: Computes 32-byte proof satisfying difficulty N
async function solvePoW(nonceHex: string, difficulty: number): Promise<Uint8Array> {
  const nonce = hexToBytes(nonceHex);
  const proof = new Uint8Array(32);
  let counter = 0n;

  while (true) {
    let temp = counter;
    for (let i = 31; i >= 24; i--) {
      proof[i] = Number(temp & 0xFFn);
      temp >>= 8n;
    }

    const data = new Uint8Array(64);
    data.set(nonce, 0);
    data.set(proof, 32);

    const hash = sha256(data);
    if (hasLeadingZeroBits(hash, difficulty)) {
      return proof;
    }
    counter++;
  }
}

// Envelope Serializer
export function serializeEnvelope(env: Envelope): Uint8Array {
  const headerSize = 46;
  const buffer = new Uint8Array(headerSize + env.payload.length);
  const view = new DataView(buffer.buffer);

  buffer[0] = env.version;
  buffer[1] = env.type;
  buffer.set(env.recipient, 2);
  
  view.setBigUint64(34, env.timestamp, false); // BigEndian
  view.setUint32(42, env.payload.length, false); // BigEndian
  buffer.set(env.payload, headerSize);

  return buffer;
}

// Envelope Parser
export function parseEnvelope(raw: Uint8Array): Envelope {
  const headerSize = 46;
  if (raw.length < headerSize) {
    throw new Error("Envelope too short");
  }

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const version = raw[0];
  const type = raw[1];
  const recipient = raw.slice(2, 34);
  const timestamp = view.getBigUint64(34, false);
  const payloadLen = view.getUint32(42, false);

  if (raw.length < headerSize + payloadLen) {
    throw new Error("Envelope truncated");
  }

  const payload = raw.slice(headerSize, headerSize + payloadLen);
  return { version, type, recipient, timestamp, payload };
}

export type NetworkMessageHandler = (senderId: string, text: string, timestamp: Date) => void;

export class WebSocketManager {
  private socket: WebSocket | null = null;
  private accountId: string;
  private onMessageCallback: NetworkMessageHandler;
  private isConnecting = false;

  constructor(accountId: string, onMessage: NetworkMessageHandler) {
    this.accountId = accountId;
    this.onMessageCallback = onMessage;
  }

  /**
   * Performs the PoW handshake and connects the WebSocket.
   */
  async connect(): Promise<void> {
    if (this.socket || this.isConnecting) return;
    this.isConnecting = true;

    try {
      console.log("🔒 Récupération du challenge PoW...");
      const challengeRes = await fetch(`${API_BASE_URL}/pow/challenge`, { method: 'POST' });
      if (!challengeRes.ok) throw new Error("Impossible de récupérer le challenge PoW");
      
      const challenge = await challengeRes.json();
      console.log(`🧠 Résolution du challenge PoW (Difficulté: ${challenge.difficulty})...`);
      
      const proofBytes = await solvePoW(challenge.nonce, challenge.difficulty);
      const proofHex = bytesToHex(proofBytes);

      console.log("🔒 Vérification du PoW auprès du serveur...");
      const verifyRes = await fetch(`${API_BASE_URL}/pow/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce: challenge.nonce, proof: proofHex })
      });
      if (!verifyRes.ok) throw new Error("La vérification PoW a échoué");

      const verifyData = await verifyRes.json();
      const token = verifyData.token;

      // Hex encode the Account ID (Go server expects 32 bytes hex)
      const accountIdBytes = bs58.decode(this.accountId);
      const accountIdHex = bytesToHex(accountIdBytes);

      const wsUrl = `${WS_BASE_URL}/ws?token=${token}&account_id=${accountIdHex}`;
      console.log(`🔌 Connexion au WebSocket : ${wsUrl}`);
      
      this.socket = new WebSocket(wsUrl);
      this.socket.binaryType = 'arraybuffer';

      this.socket.onopen = () => {
        console.log("✅ WebSocket connecté avec succès !");
        this.isConnecting = false;
      };

      this.socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          try {
            const raw = new Uint8Array(event.data);
            const env = parseEnvelope(raw);
            
            // Envelope payload is decodable for Phase 3 (JSON plaintext)
            const decoder = new TextDecoder();
            const innerPayload = JSON.parse(decoder.decode(env.payload));
            
            if (innerPayload.sender_id && innerPayload.text) {
              this.onMessageCallback(
                innerPayload.sender_id,
                innerPayload.text,
                new Date(Number(env.timestamp / 1000000n)) // Nanoseconds to milliseconds
              );
            }
          } catch (e) {
            console.error("❌ Impossible de traiter l'enveloppe entrante :", e);
          }
        }
      };

      this.socket.onclose = () => {
        console.log("⚠️ WebSocket fermé. Reconnexion dans 5s...");
        this.socket = null;
        this.isConnecting = false;
        setTimeout(() => this.connect(), 5000);
      };

      this.socket.onerror = (err) => {
        console.error("❌ Erreur WebSocket :", err);
        this.socket?.close();
      };

    } catch (err) {
      console.error("❌ Échec de la connexion réseau :", err);
      this.isConnecting = false;
      setTimeout(() => this.connect(), 10000); // retry after 10s
    }
  }

  /**
   * Wraps and transmits a message to a recipient.
   */
  sendMessage(toAccountId: string, text: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Impossible d'envoyer le message : WebSocket déconnecté");
    }

    const recipientBytes = bs58.decode(toAccountId);
    if (recipientBytes.length !== 32) {
      throw new Error("L'identifiant du destinataire doit faire 32 octets");
    }

    // Phase 3 simulated payload (plaintext JSON)
    const payloadObject = {
      sender_id: this.accountId,
      text: text
    };
    const encoder = new TextEncoder();
    const payloadBytes = encoder.encode(JSON.stringify(payloadObject));

    // Construct the envelope
    const env: Envelope = {
      version: 1,
      type: 1, // TypeMessage
      recipient: recipientBytes,
      timestamp: BigInt(Date.now()) * 1000000n, // Convert to nanoseconds
      payload: payloadBytes
    };

    const rawEnvelope = serializeEnvelope(env);
    this.socket.send(rawEnvelope);
    console.log(`📤 Enveloppe expédiée vers ${toAccountId}`);
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
  }
}
