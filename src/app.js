const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { createDatabase } = require('./db');
const { hashPassword, verifyPassword, createSessionToken, hashToken } = require('./security');

const MAX_BODY_BYTES = 1_000_000;
const USERNAME_RE = /^[A-Za-z0-9_]{3,24}$/;

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer'
  });
  res.end(body);
}

function parseJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function publicUser(row) {
  return row && {
    id: row.id,
    username: row.username,
    bio: row.bio,
    avatar: row.avatar || null,
    createdAt: row.created_at
  };
}

function cleanText(value, max, field) {
  const text = String(value ?? '').trim();
  if (!text) throw Object.assign(new Error(`${field} is required.`), { status: 400 });
  if (text.length > max) throw Object.assign(new Error(`${field} must be at most ${max} characters.`), { status: 400 });
  return text;
}

function bearerToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

function isFriend(db, userId, otherId) {
  const a = Math.min(userId, otherId);
  const b = Math.max(userId, otherId);
  return Boolean(db.prepare('SELECT 1 FROM friendships WHERE user_a_id = ? AND user_b_id = ?').get(a, b));
}

function createApp({ dbPath = process.env.DB_PATH || './data/mash.db', publicDir = path.join(__dirname, '..', 'public'), sessionHours = Number(process.env.SESSION_HOURS || 24) } = {}) {
  const db = createDatabase(dbPath);

  function currentUser(req) {
    const token = bearerToken(req);
    if (!token) return null;
    const row = db.prepare(`
      SELECT u.* FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND datetime(s.expires_at) > datetime('now')
    `).get(hashToken(token));
    return row || null;
  }

  function requireUser(req) {
    const user = currentUser(req);
    if (!user) throw Object.assign(new Error('Authentication required.'), { status: 401 });
    return user;
  }

  async function handleApi(req, res, url) {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    if (method === 'GET' && pathname === '/api/health') {
      return json(res, 200, { status: 'ok' });
    }

    if (method === 'POST' && pathname === '/api/auth/register') {
      const body = await parseJson(req);
      const username = cleanText(body.username, 24, 'Username');
      const email = cleanText(body.email, 120, 'Email').toLowerCase();
      const password = String(body.password || '');
      if (!USERNAME_RE.test(username)) throw Object.assign(new Error('Username must be 3-24 characters using letters, numbers, or underscores.'), { status: 400 });
      if (!/^\S+@\S+\.\S+$/.test(email)) throw Object.assign(new Error('Enter a valid email address.'), { status: 400 });
      if (password.length < 8 || password.length > 128) throw Object.assign(new Error('Password must be 8-128 characters.'), { status: 400 });
      const exists = db.prepare('SELECT 1 FROM users WHERE username = ? OR email = ?').get(username, email);
      if (exists) throw Object.assign(new Error('Username or email already exists.'), { status: 409 });
      const { hash, salt } = await hashPassword(password);
      const result = db.prepare('INSERT INTO users (username, email, password_hash, password_salt) VALUES (?, ?, ?, ?)').run(username, email, hash, salt);
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
      return json(res, 201, { user: publicUser(user) });
    }

    if (method === 'POST' && pathname === '/api/auth/login') {
      const body = await parseJson(req);
      const username = cleanText(body.username, 120, 'Username or email');
      const password = String(body.password || '');
      const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username.toLowerCase());
      if (!user || !(await verifyPassword(password, user.password_salt, user.password_hash))) {
        throw Object.assign(new Error('Invalid username/email or password.'), { status: 401 });
      }
      db.prepare("DELETE FROM sessions WHERE datetime(expires_at) <= datetime('now')").run();
      const token = createSessionToken();
      const expires = new Date(Date.now() + sessionHours * 60 * 60 * 1000).toISOString();
      db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), user.id, expires);
      return json(res, 200, { token, expiresAt: expires, user: publicUser(user) });
    }

    if (method === 'POST' && pathname === '/api/auth/logout') {
      const token = bearerToken(req);
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
      return json(res, 200, { ok: true });
    }

    if (method === 'GET' && pathname === '/api/me') {
      const user = requireUser(req);
      return json(res, 200, { user: publicUser(user) });
    }

    if (method === 'PATCH' && pathname === '/api/me') {
      const user = requireUser(req);
      const body = await parseJson(req);
      const bio = body.bio == null ? user.bio : String(body.bio).trim();
      if (bio.length > 280) throw Object.assign(new Error('Bio must be at most 280 characters.'), { status: 400 });
      let avatar = body.avatar == null ? user.avatar : String(body.avatar);
      if (avatar && avatar.length > 750_000) throw Object.assign(new Error('Avatar is too large.'), { status: 400 });
      if (avatar && !avatar.startsWith('data:image/')) throw Object.assign(new Error('Avatar must be an image data URL.'), { status: 400 });
      db.prepare('UPDATE users SET bio = ?, avatar = ? WHERE id = ?').run(bio || 'New to Mash.', avatar || null, user.id);
      return json(res, 200, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
    }

    if (method === 'GET' && pathname === '/api/users') {
      const user = requireUser(req);
      const q = String(url.searchParams.get('q') || '').trim();
      if (!q) return json(res, 200, { users: [] });
      const rows = db.prepare('SELECT * FROM users WHERE id <> ? AND username LIKE ? ORDER BY username LIMIT 12').all(user.id, `%${q}%`);
      return json(res, 200, { users: rows.map(publicUser) });
    }

    if (method === 'GET' && pathname === '/api/feed') {
      const user = requireUser(req);
      const rows = db.prepare(`
        SELECT p.id, p.title, p.body, p.image, p.created_at, u.username, u.avatar
        FROM posts p JOIN users u ON u.id = p.user_id
        WHERE p.user_id = ? OR p.user_id IN (
          SELECT CASE WHEN user_a_id = ? THEN user_b_id ELSE user_a_id END
          FROM friendships WHERE user_a_id = ? OR user_b_id = ?
        )
        ORDER BY datetime(p.created_at) DESC, p.id DESC LIMIT 100
      `).all(user.id, user.id, user.id, user.id);
      return json(res, 200, { posts: rows.map(r => ({ id: r.id, title: r.title, body: r.body, image: r.image, createdAt: r.created_at, author: { username: r.username, avatar: r.avatar || null } })) });
    }

    if (method === 'POST' && pathname === '/api/posts') {
      const user = requireUser(req);
      const body = await parseJson(req);
      const title = cleanText(body.title, 100, 'Title');
      const postBody = cleanText(body.body, 1000, 'Post');
      const image = body.image ? String(body.image) : null;
      if (image && (image.length > 750_000 || !image.startsWith('data:image/'))) throw Object.assign(new Error('Post image must be a small image data URL.'), { status: 400 });
      const result = db.prepare('INSERT INTO posts (user_id, title, body, image) VALUES (?, ?, ?, ?)').run(user.id, title, postBody, image);
      return json(res, 201, { id: Number(result.lastInsertRowid) });
    }

    if (method === 'GET' && pathname === '/api/friends') {
      const user = requireUser(req);
      const friends = db.prepare(`
        SELECT u.* FROM users u
        JOIN friendships f ON (u.id = f.user_a_id OR u.id = f.user_b_id)
        WHERE (f.user_a_id = ? OR f.user_b_id = ?) AND u.id <> ? ORDER BY u.username
      `).all(user.id, user.id, user.id).map(publicUser);
      const incoming = db.prepare('SELECT u.* FROM friend_requests r JOIN users u ON u.id = r.sender_id WHERE r.receiver_id = ? ORDER BY r.created_at DESC').all(user.id).map(publicUser);
      const outgoing = db.prepare('SELECT u.* FROM friend_requests r JOIN users u ON u.id = r.receiver_id WHERE r.sender_id = ? ORDER BY r.created_at DESC').all(user.id).map(publicUser);
      return json(res, 200, { friends, incoming, outgoing });
    }

    if (method === 'POST' && pathname === '/api/friends/request') {
      const user = requireUser(req);
      const body = await parseJson(req);
      const username = cleanText(body.username, 24, 'Username');
      const target = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      if (!target) throw Object.assign(new Error('User not found.'), { status: 404 });
      if (target.id === user.id) throw Object.assign(new Error('You cannot add yourself.'), { status: 400 });
      if (isFriend(db, user.id, target.id)) throw Object.assign(new Error('You are already friends.'), { status: 409 });
      const reverse = db.prepare('SELECT 1 FROM friend_requests WHERE sender_id = ? AND receiver_id = ?').get(target.id, user.id);
      if (reverse) throw Object.assign(new Error('This user already sent you a request. Accept it instead.'), { status: 409 });
      try {
        db.prepare('INSERT INTO friend_requests (sender_id, receiver_id) VALUES (?, ?)').run(user.id, target.id);
      } catch {
        throw Object.assign(new Error('Friend request already sent.'), { status: 409 });
      }
      return json(res, 201, { ok: true });
    }

    if (method === 'POST' && pathname === '/api/friends/respond') {
      const user = requireUser(req);
      const body = await parseJson(req);
      const username = cleanText(body.username, 24, 'Username');
      const action = body.action;
      if (!['accept', 'decline'].includes(action)) throw Object.assign(new Error('Action must be accept or decline.'), { status: 400 });
      const sender = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      if (!sender) throw Object.assign(new Error('User not found.'), { status: 404 });
      const request = db.prepare('SELECT 1 FROM friend_requests WHERE sender_id = ? AND receiver_id = ?').get(sender.id, user.id);
      if (!request) throw Object.assign(new Error('Friend request not found.'), { status: 404 });
      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM friend_requests WHERE sender_id = ? AND receiver_id = ?').run(sender.id, user.id);
        if (action === 'accept') {
          const a = Math.min(sender.id, user.id); const b = Math.max(sender.id, user.id);
          db.prepare('INSERT OR IGNORE INTO friendships (user_a_id, user_b_id) VALUES (?, ?)').run(a, b);
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK'); throw error;
      }
      return json(res, 200, { ok: true });
    }

    if (method === 'DELETE' && pathname.startsWith('/api/friends/')) {
      const user = requireUser(req);
      const username = decodeURIComponent(pathname.slice('/api/friends/'.length));
      const target = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      if (!target) throw Object.assign(new Error('User not found.'), { status: 404 });
      const a = Math.min(user.id, target.id); const b = Math.max(user.id, target.id);
      db.prepare('DELETE FROM friendships WHERE user_a_id = ? AND user_b_id = ?').run(a, b);
      return json(res, 200, { ok: true });
    }

    if (method === 'GET' && pathname.startsWith('/api/messages/')) {
      const user = requireUser(req);
      const username = decodeURIComponent(pathname.slice('/api/messages/'.length));
      const target = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      if (!target) throw Object.assign(new Error('User not found.'), { status: 404 });
      if (!isFriend(db, user.id, target.id)) throw Object.assign(new Error('Messaging is available between friends only.'), { status: 403 });
      const rows = db.prepare(`
        SELECT m.id, m.body, m.created_at, s.username AS sender, r.username AS receiver
        FROM messages m JOIN users s ON s.id = m.sender_id JOIN users r ON r.id = m.receiver_id
        WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
        ORDER BY datetime(m.created_at), m.id
        LIMIT 250
      `).all(user.id, target.id, target.id, user.id);
      return json(res, 200, { messages: rows.map(r => ({ id: r.id, body: r.body, sender: r.sender, receiver: r.receiver, createdAt: r.created_at })) });
    }

    if (method === 'POST' && pathname === '/api/messages') {
      const user = requireUser(req);
      const body = await parseJson(req);
      const username = cleanText(body.username, 24, 'Username');
      const message = cleanText(body.body, 1000, 'Message');
      const target = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      if (!target) throw Object.assign(new Error('User not found.'), { status: 404 });
      if (!isFriend(db, user.id, target.id)) throw Object.assign(new Error('Messaging is available between friends only.'), { status: 403 });
      const result = db.prepare('INSERT INTO messages (sender_id, receiver_id, body) VALUES (?, ?, ?)').run(user.id, target.id, message);
      return json(res, 201, { id: Number(result.lastInsertRowid) });
    }

    return json(res, 404, { error: 'API route not found.' });
  }

  function serveStatic(req, res, url) {
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    const safePath = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
    const filePath = path.join(publicDir, safePath);
    if (!filePath.startsWith(path.resolve(publicDir))) return json(res, 403, { error: 'Forbidden.' });
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      const fallback = path.join(publicDir, 'index.html');
      if (fs.existsSync(fallback)) return sendFile(res, fallback);
      return json(res, 404, { error: 'Not found.' });
    }
    return sendFile(res, filePath);
  }

  function sendFile(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4' };
    const stat = fs.statSync(filePath);
    res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream', 'content-length': stat.size, 'x-content-type-options': 'nosniff' });
    fs.createReadStream(filePath).pipe(res);
  }

  async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      return serveStatic(req, res, url);
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Internal server error.' });
      if (!error.status) console.error(error);
    }
  }

  handler.close = () => db.close();
  handler.db = db;
  return handler;
}

module.exports = { createApp };
