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
 * Sanitizes a filename to prevent Path Traversal attacks.
 * Removes directory paths, null bytes, and parent directory references.
 */
export function sanitizeFilename(filename: string): string {
  // Remove null bytes
  let clean = filename.replace(/\0/g, '');
  // Extract just the base name (handles both Unix and Windows separators)
  clean = clean.split(/[/\\]/).pop() || 'unnamed_file';
  // Strip relative paths components just in case
  clean = clean.replace(/^\.+/, '').trim();
  return clean || 'unnamed_file';
}

/**
 * Encrypts a file via streaming to prevent OOM errors.
 * Each chunk is encrypted with XChaCha20-Poly1305 using a random nonce and the chunk index as AAD.
 * The final chunk is padded to a multiple of 1MB to prevent file size inference.
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
  let chunkIndex = 0;
  const hashContext = sha256.create();
  const blobId = bs58.encode(x25519.utils.randomPrivateKey().slice(0, 16));

  try {
    while (true) {
      const chunk = await reader.read(CHUNK_SIZE);
      if (!chunk || chunk.length === 0) break;
      
      totalSize += chunk.length;
      hashContext.update(chunk);

      // Pad the chunk if it's smaller than CHUNK_SIZE to obfuscate file size
      let dataToEncrypt = chunk;
      if (chunk.length < CHUNK_SIZE) {
        dataToEncrypt = new Uint8Array(CHUNK_SIZE);
        dataToEncrypt.set(chunk, 0);
        // Fill the rest with secure random data for cryptographic padding
        const padding = x25519.utils.randomPrivateKey(); 
        for (let i = chunk.length; i < CHUNK_SIZE; i++) {
          dataToEncrypt[i] = padding[i % padding.length];
        }
      }

      // Chunk index as Additional Authenticated Data (AAD) prevents chunk reordering/dropping
      const aad = new Uint8Array(4);
      new DataView(aad.buffer).setUint32(0, chunkIndex, false); // Big-endian

      // Random 24-byte nonce for each chunk
      const nonce = x25519.utils.randomPrivateKey().slice(0, 24);
      const cipher = xchacha20poly1305(secureKey.expose(), nonce, aad);
      
      const ciphertextBase = cipher.encrypt(dataToEncrypt);
      
      // Output chunk format: [Nonce (24)] + [Ciphertext + MAC (CHUNK_SIZE + 16)]
      const outChunk = new Uint8Array(nonce.length + ciphertextBase.length);
      outChunk.set(nonce, 0);
      outChunk.set(ciphertextBase, nonce.length);
      
      await writer.write(outChunk);
      chunkIndex++;
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
    filename: sanitizeFilename(filename),
    mime_type: mimeType
  };
}

/**
 * Decrypts a file stream securely. 
 * Validates chunk sequence via AAD, truncates padding, and verifies the final SHA-256 hash.
 */
export async function decryptFileStream(
  reader: StreamReader,
  writer: StreamWriter,
  metadata: AttachmentMetadata
): Promise<void> {
  const ephemeralKey = bs58.decode(metadata.ephemeral_key);
  const secureKey = SecureBuffer.from(ephemeralKey);
  const hashContext = sha256.create();
  
  // A padded ciphertext chunk is CHUNK_SIZE + 24 (nonce) + 16 (MAC)
  const EXPECTED_ENCRYPTED_CHUNK_SIZE = CHUNK_SIZE + 40;
  
  let bytesWritten = 0;
  let chunkIndex = 0;

  try {
    while (true) {
      const chunk = await reader.read(EXPECTED_ENCRYPTED_CHUNK_SIZE);
      if (!chunk || chunk.length === 0) break;

      if (chunk.length !== EXPECTED_ENCRYPTED_CHUNK_SIZE) {
        throw new Error("Invalid encrypted chunk size. Storage has been tampered with.");
      }

      const nonce = chunk.slice(0, 24);
      const ciphertext = chunk.slice(24);

      // Reconstruct AAD for this specific chunk index
      const aad = new Uint8Array(4);
      new DataView(aad.buffer).setUint32(0, chunkIndex, false);

      const cipher = xchacha20poly1305(secureKey.expose(), nonce, aad);
      
      let plaintext: Uint8Array;
      try {
        plaintext = cipher.decrypt(ciphertext);
      } catch (err) {
        throw new Error(`MAC/AAD validation failed for chunk ${chunkIndex}. Potential reordering, dropping, or tampering attack detected.`);
      }

      // Truncate padding on the last chunk based on the exact expected file size
      let dataToWrite = plaintext;
      if (bytesWritten + plaintext.length > metadata.size) {
        const remainingBytes = metadata.size - bytesWritten;
        dataToWrite = plaintext.slice(0, remainingBytes);
      }

      if (dataToWrite.length > 0) {
        hashContext.update(dataToWrite);
        await writer.write(dataToWrite);
        bytesWritten += dataToWrite.length;
      }
      
      plaintext.fill(0); // Zero intermediate plaintext buffers
      chunkIndex++;
    }
  } finally {
    await writer.close();
    secureKey.zero();
  }

  if (bytesWritten !== metadata.size) {
    throw new Error(`Size mismatch. Expected ${metadata.size}, got ${bytesWritten}.`);
  }

  const finalHash = bs58.encode(hashContext.digest());
  if (finalHash !== metadata.sha256_hash) {
    throw new Error("Security Error: SHA-256 hash mismatch! File integrity compromised.");
  }
}
