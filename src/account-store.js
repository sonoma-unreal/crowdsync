import crypto from 'node:crypto';
import { Pool } from 'pg';

const SESSION_COOKIE_MAX_AGE = 10 * 365 * 24 * 60 * 60;
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const cleanAccount = (account) => {
  const name = String(account.name || '').trim().slice(0, 120);
  const firstName = String(account.firstName || name.split(/\s+/)[0] || '').trim().slice(0, 48);
  return {
    sub: String(account.sub || '').slice(0, 255),
    email: String(account.email || '').trim().slice(0, 254),
    name,
    firstName,
  };
};

export function createAccountStore({ databaseUrl = process.env.DATABASE_URL } = {}) {
  const accounts = new Map();
  const sessions = new Map();
  const shows = new Map();
  const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30_000 }) : null;

  return {
    get persistent() { return !!pool; },

    async initialize() {
      if (!pool) return;
      await pool.query(`
        CREATE TABLE IF NOT EXISTS lightsync_accounts (
          google_sub TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          first_name TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS lightsync_account_sessions (
          token_hash CHAR(64) PRIMARY KEY,
          google_sub TEXT NOT NULL REFERENCES lightsync_accounts(google_sub) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS lightsync_account_sessions_owner_idx ON lightsync_account_sessions(google_sub);
        CREATE TABLE IF NOT EXISTS lightsync_saved_shows (
          id UUID PRIMARY KEY,
          owner_sub TEXT NOT NULL REFERENCES lightsync_accounts(google_sub) ON DELETE CASCADE,
          name VARCHAR(48) NOT NULL,
          config JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS lightsync_saved_shows_owner_updated_idx ON lightsync_saved_shows(owner_sub, updated_at DESC);
      `);
    },

    async createSession(profile) {
      const account = cleanAccount(profile);
      if (!account.sub || !account.email) throw new TypeError('Google account subject and email are required');
      const token = crypto.randomBytes(32).toString('base64url');
      const tokenHash = hashToken(token);
      if (pool) {
        await pool.query(`
          INSERT INTO lightsync_accounts(google_sub, email, name, first_name)
          VALUES($1, $2, $3, $4)
          ON CONFLICT(google_sub) DO UPDATE SET email=EXCLUDED.email, name=EXCLUDED.name, first_name=EXCLUDED.first_name, updated_at=now()
        `, [account.sub, account.email, account.name, account.firstName]);
        await pool.query('INSERT INTO lightsync_account_sessions(token_hash, google_sub) VALUES($1, $2)', [tokenHash, account.sub]);
      } else {
        accounts.set(account.sub, account);
        sessions.set(tokenHash, account.sub);
      }
      return token;
    },

    async readSession(token) {
      if (typeof token !== 'string' || token.length > 128) return null;
      const tokenHash = hashToken(token);
      if (pool) {
        const { rows } = await pool.query(`
          SELECT a.google_sub AS sub, a.email, a.name, a.first_name AS "firstName"
          FROM lightsync_account_sessions s JOIN lightsync_accounts a USING(google_sub)
          WHERE s.token_hash=$1
        `, [tokenHash]);
        return rows[0] || null;
      }
      const sub = sessions.get(tokenHash);
      return sub ? accounts.get(sub) || null : null;
    },

    async revokeSession(token) {
      if (typeof token !== 'string' || token.length > 128) return;
      const tokenHash = hashToken(token);
      if (pool) await pool.query('DELETE FROM lightsync_account_sessions WHERE token_hash=$1', [tokenHash]);
      else sessions.delete(tokenHash);
    },

    async listShows(ownerSub) {
      if (pool) {
        const { rows } = await pool.query(`
          SELECT id, name, created_at AS "createdAt", updated_at AS "updatedAt"
          FROM lightsync_saved_shows WHERE owner_sub=$1 ORDER BY updated_at DESC, created_at DESC LIMIT 100
        `, [ownerSub]);
        return rows;
      }
      return [...shows.values()].filter((show) => show.ownerSub === ownerSub)
        .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)
        .slice(0, 100)
        .map(({ id, name, createdAt, updatedAt }) => ({ id, name, createdAt: new Date(createdAt), updatedAt: new Date(updatedAt) }));
    },

    async getShow(ownerSub, id) {
      if (pool) {
        const { rows } = await pool.query(`SELECT id, owner_sub AS "ownerSub", name, config FROM lightsync_saved_shows WHERE owner_sub=$1 AND id=$2`, [ownerSub, id]);
        return rows[0] || null;
      }
      const show = shows.get(id);
      return show?.ownerSub === ownerSub ? structuredClone(show) : null;
    },

    async createShow(ownerSub, name, config) {
      const id = crypto.randomUUID();
      if (pool) {
        await pool.query('INSERT INTO lightsync_saved_shows(id, owner_sub, name, config) VALUES($1, $2, $3, $4::jsonb)', [id, ownerSub, name, JSON.stringify(config)]);
        return id;
      }
      const now = Date.now();
      shows.set(id, { id, ownerSub, name, config: structuredClone(config), createdAt: now, updatedAt: now });
      return id;
    },

    async updateShow(ownerSub, id, name, config) {
      if (pool) {
        await pool.query('UPDATE lightsync_saved_shows SET name=$3, config=$4::jsonb, updated_at=now() WHERE owner_sub=$1 AND id=$2', [ownerSub, id, name, JSON.stringify(config)]);
        return;
      }
      const show = shows.get(id);
      if (show?.ownerSub === ownerSub) {
        show.name = name;
        show.config = structuredClone(config);
        show.updatedAt = Date.now();
      }
    },

    async deleteShow(ownerSub, id) {
      if (pool) {
        const result = await pool.query('DELETE FROM lightsync_saved_shows WHERE owner_sub=$1 AND id=$2', [ownerSub, id]);
        return result.rowCount > 0;
      }
      const show = shows.get(id);
      if (show?.ownerSub !== ownerSub) return false;
      shows.delete(id);
      return true;
    },

    async close() {
      if (pool) await pool.end();
    },
  };
}

export { SESSION_COOKIE_MAX_AGE };
