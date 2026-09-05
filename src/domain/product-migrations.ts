import type { SchemaMigration } from "./schema";

export const productMigrations: readonly SchemaMigration[] = [
  {
    version: 13,
    statements: [
      `CREATE TABLE IF NOT EXISTS knowledge_metadata (
        item_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, kind TEXT NOT NULL,
        revision INTEGER NOT NULL, source TEXT NOT NULL, category TEXT NOT NULL,
        status TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS knowledge_versions (
        item_id TEXT NOT NULL, bot_id TEXT NOT NULL, revision INTEGER NOT NULL,
        snapshot TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (item_id, revision),
        FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS knowledge_commands (
        id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, item_id TEXT NOT NULL, kind TEXT NOT NULL,
        created_at TEXT NOT NULL, FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE)`
    ]
  },
  {
    version: 14,
    statements: [
      `CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS project_teammates (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, PRIMARY KEY(project_id, bot_id))`,
      `CREATE TABLE IF NOT EXISTS project_resources (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, kind TEXT NOT NULL, item_id TEXT NOT NULL, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, PRIMARY KEY(project_id, kind, item_id))`,
      `CREATE TABLE IF NOT EXISTS project_messages (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, sender_bot_id TEXT, content TEXT NOT NULL, parent_id TEXT, created_at TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS project_message_order ON project_messages(project_id, created_at, id)`,
      `CREATE TABLE IF NOT EXISTS collaboration_deliveries (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, message_id TEXT NOT NULL REFERENCES project_messages(id) ON DELETE CASCADE, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, sender_bot_id TEXT, root_id TEXT NOT NULL, depth INTEGER NOT NULL, response INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS collaboration_pending ON collaboration_deliveries(state, created_at)`
    ]
  },
  {
    version: 15,
    statements: [
      `CREATE TABLE IF NOT EXISTS routine_settings (routine_id TEXT PRIMARY KEY REFERENCES routines(id) ON DELETE CASCADE, revision INTEGER NOT NULL, schedule_json TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS routine_runs (id TEXT PRIMARY KEY, routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, source TEXT NOT NULL, state TEXT NOT NULL, prompt TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS routine_run_queue ON routine_runs(state, updated_at)`,
      `CREATE INDEX IF NOT EXISTS routine_run_history ON routine_runs(routine_id, created_at)`
    ]
  },
  {
    version: 16,
    statements: [
      `CREATE TABLE IF NOT EXISTS event_triggers (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE, name TEXT NOT NULL, revision INTEGER NOT NULL, enabled INTEGER NOT NULL, filter_json TEXT NOT NULL, secret TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS event_receipts (trigger_id TEXT NOT NULL REFERENCES event_triggers(id) ON DELETE CASCADE, event_id TEXT NOT NULL, digest TEXT NOT NULL, state TEXT NOT NULL, run_id TEXT, created_at TEXT NOT NULL, PRIMARY KEY(trigger_id, event_id))`
    ]
  },
  {
    version: 17,
    statements: [
      `CREATE TABLE IF NOT EXISTS push_settings (id INTEGER PRIMARY KEY CHECK(id = 1), public_key TEXT NOT NULL, private_key TEXT NOT NULL, subject TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS push_devices (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, endpoint TEXT NOT NULL UNIQUE, subscription_json TEXT NOT NULL, name TEXT NOT NULL, preferences_json TEXT NOT NULL, created_at TEXT NOT NULL, last_status TEXT)`,
      `CREATE TABLE IF NOT EXISTS push_deliveries (id TEXT PRIMARY KEY, notification_id TEXT REFERENCES notifications(id) ON DELETE CASCADE, device_id TEXT NOT NULL REFERENCES push_devices(id) ON DELETE CASCADE, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS push_delivery_queue ON push_deliveries(state, next_at)`,
      `CREATE TRIGGER IF NOT EXISTS queue_notification_push AFTER INSERT ON notifications BEGIN INSERT OR IGNORE INTO push_deliveries (id, notification_id, device_id, state, next_at, created_at, updated_at) SELECT NEW.id || ':' || id, NEW.id, id, 'queued', NEW.created_at, NEW.created_at, NEW.created_at FROM push_devices; END`
    ]
  },
  {
    version: 18,
    statements: [
      `CREATE TABLE IF NOT EXISTS demonstrations (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, name TEXT NOT NULL, notes TEXT NOT NULL, video_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE, frames_json TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, skill_id TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS demonstration_queue ON demonstrations(state, updated_at)`
    ]
  },
  {
    version: 19,
    statements: [
      `CREATE TABLE IF NOT EXISTS message_discussions (id TEXT PRIMARY KEY, kind TEXT NOT NULL, source_id TEXT NOT NULL, message_id TEXT NOT NULL, bot_id TEXT REFERENCES bots(id) ON DELETE CASCADE, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, UNIQUE(kind, source_id, message_id))`,
      `CREATE TABLE IF NOT EXISTS discussion_notes (id TEXT PRIMARY KEY, discussion_id TEXT NOT NULL REFERENCES message_discussions(id) ON DELETE CASCADE, user_id TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS message_reactions (discussion_id TEXT NOT NULL REFERENCES message_discussions(id) ON DELETE CASCADE, user_id TEXT NOT NULL, emoji TEXT NOT NULL, PRIMARY KEY(discussion_id, user_id, emoji))`
    ]
  },
  {
    version: 20,
    statements: [
      `CREATE TABLE IF NOT EXISTS template_imports (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, template_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS template_shares (id TEXT PRIMARY KEY, name TEXT NOT NULL, template_json TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT)`,
      `CREATE TRIGGER IF NOT EXISTS purge_imported_template BEFORE DELETE ON bots BEGIN UPDATE template_imports SET template_json = '{}' WHERE bot_id = OLD.id; END`
    ]
  },
  {
    version: 21,
    statements: [
      `CREATE TABLE IF NOT EXISTS team_users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, role TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, salt TEXT NOT NULL, password_hash TEXT NOT NULL, iterations INTEGER NOT NULL, created_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS team_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES team_users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS team_projects (user_id TEXT NOT NULL REFERENCES team_users(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, PRIMARY KEY(user_id, project_id))`,
      `CREATE TABLE IF NOT EXISTS team_invites (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, role TEXT NOT NULL, projects_json TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS access_audit (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT NOT NULL, created_at TEXT NOT NULL)`,
      `ALTER TABLE project_messages ADD COLUMN requester_id TEXT`,
      `CREATE TABLE IF NOT EXISTS admin_policy (id INTEGER PRIMARY KEY CHECK(id=1), policy_json TEXT NOT NULL)`
    ]
  },
  {
    version: 22,
    statements: [
      `CREATE TABLE IF NOT EXISTS local_pairings (token_hash TEXT PRIMARY KEY, bots_json TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT)`,
      `CREATE TABLE IF NOT EXISTS local_devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_seen_at TEXT, revoked_at TEXT)`,
      `CREATE TABLE IF NOT EXISTS local_device_bots (device_id TEXT NOT NULL REFERENCES local_devices(id) ON DELETE CASCADE, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, PRIMARY KEY(device_id,bot_id))`,
      `CREATE TABLE IF NOT EXISTS local_jobs (id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES local_devices(id) ON DELETE CASCADE, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, task_id TEXT, command TEXT NOT NULL, directory TEXT NOT NULL, state TEXT NOT NULL, claim_id TEXT, result TEXT, delivery_state TEXT NOT NULL DEFAULT 'none', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS local_job_queue ON local_jobs(device_id,state,created_at)`
    ]
  },
  {
    version: 23,
    statements: [
      `CREATE TABLE task_projections (task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE, generation INTEGER NOT NULL, updated_at TEXT NOT NULL, state TEXT NOT NULL)`
    ]
  },
  {
    version: 24,
    statements: [
      `ALTER TABLE bots ADD COLUMN coordination_role TEXT NOT NULL DEFAULT 'member'`,
      `CREATE UNIQUE INDEX one_chief ON bots(coordination_role) WHERE coordination_role = 'chief'`,
      `ALTER TABLE projects ADD COLUMN lead_bot_id TEXT REFERENCES bots(id) ON DELETE SET NULL`,
      `UPDATE projects SET lead_bot_id = (SELECT bot_id FROM project_teammates WHERE project_id = projects.id ORDER BY bot_id LIMIT 1)`,
      `CREATE TABLE team_work (id TEXT PRIMARY KEY, owner_bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, requester_id TEXT, goal TEXT NOT NULL, criteria TEXT NOT NULL, deadline_at TEXT NOT NULL, budget_usd REAL NOT NULL, state TEXT NOT NULL, result TEXT, checks TEXT, round INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE UNIQUE INDEX one_team_owner_work ON team_work(owner_bot_id) WHERE state IN ('active', 'waiting')`,
      `CREATE TABLE team_assignments (id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES team_work(id) ON DELETE CASCADE, assignment_key TEXT NOT NULL, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, instruction TEXT NOT NULL, criterion TEXT NOT NULL, state TEXT NOT NULL, result TEXT, review TEXT, updated_at TEXT NOT NULL, UNIQUE(work_id, assignment_key))`,
      `CREATE TABLE team_turns (id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES team_work(id) ON DELETE CASCADE, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, assignment_id TEXT REFERENCES team_assignments(id) ON DELETE CASCADE, state TEXT NOT NULL, created_at TEXT NOT NULL)`,
      `CREATE TABLE team_cancellations (work_id TEXT NOT NULL, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, PRIMARY KEY (work_id, bot_id))`,
      `CREATE INDEX team_turn_queue ON team_turns(state, created_at)`,
      `ALTER TABLE usage_events ADD COLUMN team_work_id TEXT`,
      `CREATE INDEX team_work_costs ON usage_events(team_work_id)`
    ]
  }
];
