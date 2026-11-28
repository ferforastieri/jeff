-- Jeff on SQLite.
--
-- Type rules used by the Rust code: every integer the code reads as i64 is
-- INTEGER (ids, timestamps, flags). Keep flags as INTEGER so `!= 0` comparisons
-- survive. JSON stays TEXT and uses JSON1. Search uses FTS5 external-content
-- tables with triggers.

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    display_name TEXT NOT NULL DEFAULT '',
    activity TEXT NOT NULL DEFAULT '',
    onboarded_at TEXT,
    email TEXT,
    dev_access INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    root TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#A8C66C',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_members (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY(project_id, user_id)
);

CREATE TABLE IF NOT EXISTS invites (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'member',
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    used_by INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS workspaces (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    layout TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, project_id)
);

CREATE TABLE IF NOT EXISTS bot_messages (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL,
    bot_id TEXT,
    created_at INTEGER NOT NULL,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, project_id, mode, channel, message_id)
);
CREATE INDEX IF NOT EXISTS idx_bot_messages_page
    ON bot_messages(user_id, project_id, mode, channel, role, created_at DESC, message_id DESC);
CREATE INDEX IF NOT EXISTS idx_bot_messages_bot
    ON bot_messages(user_id, project_id, bot_id);

CREATE TABLE IF NOT EXISTS db_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    folder TEXT NOT NULL DEFAULT '',
    project_root TEXT NOT NULL DEFAULT '',
    driver TEXT NOT NULL,
    dsn_encrypted TEXT NOT NULL,
    read_only INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS web_targets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_tokens (
    token TEXT PRIMARY KEY,
    platform TEXT NOT NULL DEFAULT '',
    user_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'ai',
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    project_id TEXT,
    project_name TEXT,
    chat_id TEXT,
    session_id TEXT,
    bot_id TEXT,
    bot_name TEXT,
    bot_role TEXT,
    notification_id TEXT,
    room_id TEXT,
    created_at INTEGER NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notifications_user
    ON notifications(user_id, created_at DESC);

-- Dev-mode agents ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_profiles (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    chat_id TEXT NOT NULL,
    config TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    chat_id TEXT NOT NULL,
    agent_id TEXT NOT NULL REFERENCES agent_profiles(id),
    title TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_session_active
    ON agent_sessions(user_id, project_id, chat_id, agent_id) WHERE archived = 0;
CREATE INDEX IF NOT EXISTS agent_session_chat
    ON agent_sessions(user_id, project_id, chat_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id),
    parent_id TEXT REFERENCES agent_runs(id),
    user_id INTEGER NOT NULL,
    project_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    state TEXT NOT NULL,
    error TEXT NOT NULL DEFAULT '',
    config TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    finished_at INTEGER,
    UNIQUE(user_id, project_id, request_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_run_active
    ON agent_runs(session_id) WHERE state IN ('queued', 'running', 'waiting');
CREATE INDEX IF NOT EXISTS agent_runs_chat
    ON agent_runs(user_id, project_id, chat_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_run_recoveries (
    run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
    attempts INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_messages (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id),
    run_id TEXT REFERENCES agent_runs(id),
    role TEXT NOT NULL,
    body TEXT NOT NULL,
    display TEXT NOT NULL,
    content_text TEXT NOT NULL,
    estimated_tokens INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_message_page ON agent_messages(session_id, seq);

CREATE VIRTUAL TABLE IF NOT EXISTS agent_history_fts USING fts5(
    content_text,
    content='agent_messages',
    content_rowid='seq',
    tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS agent_history_fts_ai AFTER INSERT ON agent_messages BEGIN
    INSERT INTO agent_history_fts(rowid, content_text) VALUES (new.seq, new.content_text);
END;

CREATE TRIGGER IF NOT EXISTS agent_history_fts_ad AFTER DELETE ON agent_messages BEGIN
    INSERT INTO agent_history_fts(agent_history_fts, rowid, content_text)
    VALUES ('delete', old.seq, old.content_text);
END;

CREATE TRIGGER IF NOT EXISTS agent_history_fts_au AFTER UPDATE ON agent_messages BEGIN
    INSERT INTO agent_history_fts(agent_history_fts, rowid, content_text)
    VALUES ('delete', old.seq, old.content_text);
    INSERT INTO agent_history_fts(rowid, content_text) VALUES (new.seq, new.content_text);
END;

CREATE TABLE IF NOT EXISTS agent_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id),
    run_id TEXT REFERENCES agent_runs(id),
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_event_session ON agent_events(session_id, seq);
CREATE INDEX IF NOT EXISTS agent_event_run ON agent_events(run_id, seq);
CREATE INDEX IF NOT EXISTS agent_event_kind ON agent_events(session_id, kind, seq);

CREATE TABLE IF NOT EXISTS agent_checkpoints (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id),
    through_seq INTEGER NOT NULL,
    summary TEXT NOT NULL,
    estimated_tokens INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_checkpoint_latest
    ON agent_checkpoints(session_id, through_seq DESC);

CREATE TABLE IF NOT EXISTS agent_session_state (
    session_id TEXT PRIMARY KEY REFERENCES agent_sessions(id) ON DELETE CASCADE,
    ledger TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_tool_calls (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES agent_runs(id),
    call_id TEXT NOT NULL,
    name TEXT NOT NULL,
    arguments TEXT NOT NULL,
    state TEXT NOT NULL,
    result TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(run_id, call_id)
);

CREATE TABLE IF NOT EXISTS agent_model_calls (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES agent_runs(id),
    kind TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cached_tokens INTEGER NOT NULL,
    reasoning_tokens INTEGER NOT NULL,
    estimated_input INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    finish TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_usage_run ON agent_model_calls(run_id, created_at);

CREATE TABLE IF NOT EXISTS agent_artifacts (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    project_id TEXT NOT NULL,
    run_id TEXT REFERENCES agent_runs(id),
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    path TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_memories (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    project_id TEXT NOT NULL,
    content TEXT NOT NULL,
    source_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_memory_project
    ON agent_memories(user_id, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_skills (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    body TEXT NOT NULL,
    agents TEXT NOT NULL DEFAULT '[]',
    state TEXT NOT NULL DEFAULT 'active',
    replaces TEXT,
    proposed_by TEXT,
    reason TEXT,
    source TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_skill_active_name
    ON agent_skills(project_id, name) WHERE state = 'active';
CREATE INDEX IF NOT EXISTS agent_skill_project ON agent_skills(project_id, state, name);

CREATE TABLE IF NOT EXISTS agent_skill_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_id TEXT NOT NULL REFERENCES agent_skills(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    body TEXT NOT NULL,
    by TEXT NOT NULL,
    at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_skill_versions_skill
    ON agent_skill_versions(skill_id, at DESC);

-- Room world --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS principals (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('human', 'bot')),
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    handle TEXT NOT NULL,
    avatar TEXT NOT NULL DEFAULT '{}',
    bot TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS principal_handle ON principals(handle);
CREATE UNIQUE INDEX IF NOT EXISTS principal_user ON principals(user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS channel_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'room' CHECK(kind IN ('room', 'dm')),
    name TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    lead_id TEXT REFERENCES principals(id) ON DELETE SET NULL,
    isolated INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    repos TEXT NOT NULL DEFAULT '[]',
    category_id TEXT REFERENCES channel_categories(id) ON DELETE SET NULL,
    visibility TEXT NOT NULL DEFAULT 'private',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS room_project ON rooms(project_id, archived, updated_at DESC);

CREATE TABLE IF NOT EXISTS room_members (
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    principal_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY(room_id, principal_id)
);

CREATE TABLE IF NOT EXISTS room_messages (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES principals(id),
    text TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'message',
    reply_to TEXT,
    task_id TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS room_message_page ON room_messages(room_id, seq);

CREATE VIRTUAL TABLE IF NOT EXISTS room_message_fts USING fts5(
    text,
    content='room_messages',
    content_rowid='seq',
    tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS room_message_fts_ai AFTER INSERT ON room_messages BEGIN
    INSERT INTO room_message_fts(rowid, text) VALUES (new.seq, new.text);
END;

CREATE TRIGGER IF NOT EXISTS room_message_fts_ad AFTER DELETE ON room_messages BEGIN
    INSERT INTO room_message_fts(room_message_fts, rowid, text)
    VALUES ('delete', old.seq, old.text);
END;

CREATE TRIGGER IF NOT EXISTS room_message_fts_au AFTER UPDATE ON room_messages BEGIN
    INSERT INTO room_message_fts(room_message_fts, rowid, text)
    VALUES ('delete', old.seq, old.text);
    INSERT INTO room_message_fts(rowid, text) VALUES (new.seq, new.text);
END;

CREATE TABLE IF NOT EXISTS room_deliveries (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL REFERENCES room_messages(id) ON DELETE CASCADE,
    recipient_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
    sender_kind TEXT NOT NULL,
    sender_id TEXT,
    reply_to TEXT,
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN
        ('queued', 'starting', 'running', 'completed', 'failed', 'interrupted', 'cancelled')),
    position INTEGER NOT NULL DEFAULT 0,
    turn_id TEXT,
    error TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(recipient_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS room_delivery_queue
    ON room_deliveries(recipient_id, status, position, created_at);

CREATE TABLE IF NOT EXISTS room_queue_state (
    principal_id TEXT PRIMARY KEY REFERENCES principals(id) ON DELETE CASCADE,
    paused INTEGER NOT NULL DEFAULT 0,
    hold TEXT,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS room_sessions (
    principal_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    engine TEXT NOT NULL,
    session_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(principal_id, room_id)
);

CREATE TABLE IF NOT EXISTS room_tasks (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    owner_id TEXT REFERENCES principals(id) ON DELETE SET NULL,
    state TEXT NOT NULL DEFAULT 'open',
    instruction TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
    message_id TEXT,
    task_id TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    owner_id TEXT REFERENCES principals(id) ON DELETE SET NULL,
    due_at INTEGER,
    priority TEXT NOT NULL DEFAULT 'normal',
    attachments TEXT NOT NULL DEFAULT '[]',
    column_name TEXT NOT NULL DEFAULT 'todo'
        CHECK(column_name IN ('todo', 'doing', 'review', 'blocked', 'done')),
    created_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS card_board
    ON cards(project_id, column_name, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS card_message_owner
    ON cards(message_id, owner_id) WHERE message_id IS NOT NULL AND owner_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS routines (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    instruction TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    timezone TEXT NOT NULL,
    limit_policy TEXT NOT NULL DEFAULT 'wait',
    missed_policy TEXT NOT NULL DEFAULT 'skip',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS routine_name ON routines(room_id, name);
CREATE INDEX IF NOT EXISTS routine_project ON routines(project_id, active);

CREATE TABLE IF NOT EXISTS routine_triggers (
    id TEXT PRIMARY KEY,
    routine_id TEXT NOT NULL UNIQUE REFERENCES routines(id) ON DELETE CASCADE,
    schedule TEXT NOT NULL,
    next_run_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS routine_due
    ON routine_triggers(next_run_at) WHERE next_run_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS routine_runs (
    id TEXT PRIMARY KEY,
    routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    trigger_id TEXT,
    agent_id TEXT NOT NULL,
    room_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('scheduled', 'manual')),
    source TEXT,
    scheduled_for INTEGER NOT NULL,
    routine_name TEXT NOT NULL,
    instruction TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN
        ('queued', 'running', 'needs-attention', 'succeeded', 'failed', 'interrupted', 'cancelled')),
    error TEXT NOT NULL DEFAULT '',
    no_update INTEGER NOT NULL DEFAULT 0,
    delivery_id TEXT UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(trigger_id, scheduled_for)
);
CREATE INDEX IF NOT EXISTS routine_runs_list
    ON routine_runs(routine_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bot_memories (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    normalized_text TEXT NOT NULL,
    origin TEXT NOT NULL DEFAULT 'manual' CHECK(origin IN ('manual', 'automatic')),
    source_message_id TEXT,
    site TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(agent_id, normalized_text)
);
CREATE INDEX IF NOT EXISTS bot_memory_agent
    ON bot_memories(agent_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS bot_memory_selections (
    memory_id TEXT PRIMARY KEY REFERENCES bot_memories(id) ON DELETE CASCADE,
    inclusion TEXT NOT NULL DEFAULT 'searchable' CHECK(inclusion IN ('essential', 'searchable')),
    user_controlled INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS room_events (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    room_id TEXT,
    card_id TEXT,
    actor_id TEXT,
    kind TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS room_event_room
    ON room_events(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS room_event_card
    ON room_events(card_id, created_at DESC);

CREATE TABLE IF NOT EXISTS vault_items (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('login', 'card')),
    name TEXT NOT NULL,
    username TEXT NOT NULL DEFAULT '',
    secret_enc TEXT NOT NULL,
    meta TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS vault_project ON vault_items(project_id, name);

-- SQLite has native instr/json_extract/json_set; no compatibility functions.
