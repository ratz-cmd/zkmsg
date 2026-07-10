import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { x25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { SecureBuffer } from './secureMemory';
import bs58 from 'bs58';
import type { AttachmentMetadata } from '../types/attachment';

const CHUNK_SIZE = 1024 * 1024; // 1 MB per chunk

export interface StreamReader {
  read(bytes: number): Promise<Uint8Array | null>;
}

export interface StreamWriter {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

/**
 * Encrypts a file via streaming to prevent OOM errors.
 * Each chunk is encrypted with XChaCha20-Poly1305 using a random nonce prepended to it.
 */
export async function encryptFileStream(
  reader: StreamReader,
  writer: StreamWriter,
  filename: string,
  mimeType: string
): Promise<AttachmentMetadata> {
  const ephemeralKey = x25519.utils.randomPrivateKey();
  const secureKey = SecureBuffer.from(ephemeralKey);
  
  let totalSize = 0;
  const hashContext = sha256.create();
  const blobId = bs58.encode(x25519.utils.randomPrivateKey().slice(0, 16));

  try {
    while (true) {
      const chunk = await reader.read(CHUNK_SIZE);
      if (!chunk || chunk.length === 0) break;
      
      totalSize += chunk.length;
      hashContext.update(chunk);

      // Random 24-byte nonce for each chunk
      const nonce = x25519.utils.randomPrivateKey().slice(0, 24);
      const cipher = xchacha20poly1305(secureKey.expose(), nonce);
      
      const ciphertextBase = cipher.encrypt(chunk);
      
      // Output chunk format: [Nonce (24)] + [Ciphertext + MAC]
      const outChunk = new Uint8Array(nonce.length + ciphertextBase.length);
      outChunk.set(nonce, 0);
      outChunk.set(ciphertextBase, nonce.length);
      
      await writer.write(outChunk);
    }
  } finally {
    await writer.close();
    secureKey.zero(); // Wipe key from memory
  }

  const finalHash = bs58.encode(hashContext.digest());

  return {
    type: "attachment",
    blob_id: blobId,
    ephemeral_key: bs58.encode(ephemeralKey),
    sha256_hash: finalHash,
    size: totalSize,
    filename: filename,
    mime_type: mimeType
  };
}

/**
 * Decrypts a file stream securely. Verifies the SHA-256 hash at the end.
 */
export async function decryptFileStream(
  reader: StreamReader,
  writer: StreamWriter,
  metadata: AttachmentMetadata
): Promise<void> {
  const ephemeralKey = bs58.decode(metadata.ephemeral_key);
  const secureKey = SecureBuffer.from(ephemeralKey);
  const hashContext = sha256.create();
  
  // A chunk ciphertext is CHUNK_SIZE + 24 (nonce) + 16 (MAC)
  const EXPECTED_MAX_ENCRYPTED_CHUNK_SIZE = CHUNK_SIZE + 40;

  try {
    while (true) {
      const chunk = await reader.read(EXPECTED_MAX_ENCRYPTED_CHUNK_SIZE);
      if (!chunk || chunk.length === 0) break;

      if (chunk.length <= 40) {
        throw new Error("Invalid encrypted chunk: too small");
      }

      const nonce = chunk.slice(0, 24);
      const ciphertext = chunk.slice(24);

      const cipher = xchacha20poly1305(secureKey.expose(), nonce);
      
      let plaintext: Uint8Array;
      try {
        plaintext = cipher.decrypt(ciphertext);
      } catch (err) {
        throw new Error("MAC validation failed for chunk. Attachment corrupted or tampered.");
      }

      hashContext.update(plaintext);
      await writer.write(plaintext);
      
      plaintext.fill(0); // Zero intermediate plaintext buffers
    }
  } finally {
    await writer.close();
    secureKey.zero();
  }

  const finalHash = bs58.encode(hashContext.digest());
  if (finalHash !== metadata.sha256_hash) {
    throw new Error("Security Error: SHA-256 hash mismatch! File integrity compromised.");
  }
}
