export interface AttachmentMetadata {
  type: "attachment";
  blob_id: string;             // Random identifier on the Go server
  ephemeral_key: string;       // Base58 or Base64 encoded 32-byte key
  sha256_hash: string;         // Hex or Base58 encoded SHA-256 of the *plaintext* file
  size: number;                // Size of the plaintext file in bytes
  filename: string;            // Name of the file, can be encrypted or omitted for extreme privacy
  mime_type: string;           // e.g. "image/jpeg"
}
