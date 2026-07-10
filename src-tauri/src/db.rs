use rusqlite::{Connection, params};
use tauri::{State, command};
use std::sync::Mutex;
use serde::{Serialize, Deserialize};

pub struct AppState {
    // Thread-safe mutable reference to the database connection
    pub db: Mutex<Option<Connection>>,
}

#[derive(Serialize, Deserialize)]
pub struct MessageRecord {
    pub id: String,
    pub conversation_id: String,
    pub sender_id: String,
    pub text_content: Option<String>,
    pub attachment_json: Option<String>,
    pub timestamp: i64,
    pub is_self: bool,
}

/// Invoked from React ONLY on the LockScreen. 
/// Injects the master SQLCipher key (hex) to unlock the DB in Rust memory.
#[command]
pub fn unlock_database(state: State<'_, AppState>, hex_key: String) -> Result<(), String> {
    // Debug Mode Support: Allows 2 instances simultaneously
    let db_name = std::env::var("TAURI_DB_NAME").unwrap_or_else(|_| "zkmsg_secure.db".to_string());
    let path = db_name.as_str(); // Local storage path (should be resolved to app_data_dir in prod)
    
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    
    // Apply SQLCipher encryption pragmas
    conn.pragma_update(None, "key", &hex_key).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "cipher_page_size", 4096).map_err(|e| e.to_string())?;
    
    // Verify key correctness by reading schema
    let mut stmt = conn.prepare("SELECT count(*) FROM sqlite_master;").map_err(|e| e.to_string())?;
    let _ = stmt.query_row([], |row| row.get::<_, i32>(0)).map_err(|_| "Invalid DB Key or corrupted database".to_string())?;
    
    // Initialize schema if empty
    let schema = include_str!("schema.sql");
    conn.execute_batch(schema).map_err(|e| e.to_string())?;
    
    // Safely store connection in global state
    let mut db_guard = state.db.lock().unwrap();
    drop(stmt);
    *db_guard = Some(conn);
    Ok(())
}

/// JIT Message loading for the active chat view.
#[command]
pub fn load_messages(state: State<'_, AppState>, conversation_id: String, limit: i32, offset: i32) -> Result<Vec<MessageRecord>, String> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or("Database is locked")?;
    
    let mut stmt = conn.prepare(
        "SELECT id, conversation_id, sender_id, text_content, attachment_json, timestamp, is_self 
         FROM Messages 
         WHERE conversation_id = ? 
         ORDER BY timestamp DESC 
         LIMIT ? OFFSET ?"
    ).map_err(|e| e.to_string())?;
    
    let msg_iter = stmt.query_map(params![conversation_id, limit, offset], |row| {
        Ok(MessageRecord {
            id: row.get(0)?,
            conversation_id: row.get(1)?,
            sender_id: row.get(2)?,
            text_content: row.get(3)?,
            attachment_json: row.get(4)?,
            timestamp: row.get(5)?,
            is_self: row.get::<_, i32>(6)? == 1,
        })
    }).map_err(|e| e.to_string())?;
    
    let mut msgs = Vec::new();
    for msg in msg_iter {
        if let Ok(m) = msg {
            msgs.push(m);
        }
    }
    
    // Reverse to get chronological order for UI
    msgs.reverse();
    Ok(msgs)
}

/// Atomic persistence hook for the Double Ratchet state.
/// Ensures state and message are written in a single SQL transaction.
#[command]
pub fn save_ratchet_and_message(
    state: State<'_, AppState>, 
    peer_id: String, 
    ratchet_state_json: String, 
    message: MessageRecord
) -> Result<(), String> {
    let mut db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_mut().ok_or("Database is locked")?;
    
    // Begin atomic transaction
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    
    // 1. Save Ratchet State
    tx.execute(
        "INSERT INTO RatchetStates (peer_id, state_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(peer_id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at",
        params![peer_id, ratchet_state_json, message.timestamp]
    ).map_err(|e| e.to_string())?;
    
    // 2. Save Message
    tx.execute(
        "INSERT Into Messages (id, conversation_id, sender_id, text_content, attachment_json, timestamp, is_self)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![
            message.id,
            message.conversation_id,
            message.sender_id,
            message.text_content,
            message.attachment_json,
            message.timestamp,
            if message.is_self { 1 } else { 0 }
        ]
    ).map_err(|e| e.to_string())?;
    
    // 3. Update Conversation Last Activity
    tx.execute(
        "INSERT INTO Conversations (id, peer_name, last_activity) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET last_activity=excluded.last_activity",
        params![message.conversation_id, "Unknown", message.timestamp]
    ).map_err(|e| e.to_string())?;
    
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Closes the database connection and wipes SQLite cache from RAM.
/// Triggered by React after inactivity.
#[command]
pub fn lock_database(state: State<'_, AppState>) -> Result<(), String> {
    let mut db_guard = state.db.lock().unwrap();
    // Dropping the Connection explicitly closes the DB descriptor and clears its RAM cache.
    *db_guard = None;
    Ok(())
}

