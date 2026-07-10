CREATE TABLE IF NOT EXISTS Conversations (
    id TEXT PRIMARY KEY, -- Peer Account ID (Base58)
    peer_name TEXT,
    last_activity INTEGER
);

CREATE TABLE IF NOT EXISTS Messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    text_content TEXT,
    attachment_json TEXT, -- JSON containing blob_id, ephemeral_key, size, etc.
    timestamp INTEGER NOT NULL,
    is_self INTEGER NOT NULL,
    FOREIGN KEY(conversation_id) REFERENCES Conversations(id) ON DELETE CASCADE
);

-- Optimization for JIT loading of messages
CREATE INDEX IF NOT EXISTS idx_messages_conversation_time 
ON Messages(conversation_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS RatchetStates (
    peer_id TEXT PRIMARY KEY,
    state_json TEXT NOT NULL, -- Serialized JSON of RatchetState (Roots, Chains, Skipped Keys)
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(peer_id) REFERENCES Conversations(id) ON DELETE CASCADE
);
