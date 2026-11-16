const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');

async function withServer(run) {
  const app = createApp({ dbPath: ':memory:', sessionHours: 1 });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try { await run(base); }
  finally {
    await new Promise(resolve => server.close(resolve));
    app.close();
  }
}

async function request(base, path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = {};
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

async function register(base, username, email, password = 'Password123!') {
  return request(base, '/api/auth/register', { method: 'POST', body: { username, email, password } });
}

async function login(base, username, password = 'Password123!') {
  const result = await request(base, '/api/auth/login', { method: 'POST', body: { username, password } });
  assert.equal(result.status, 200);
  return result.data.token;
}

test('health endpoint and protected endpoint behavior', async () => {
  await withServer(async base => {
    const health = await request(base, '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.data.status, 'ok');

    const me = await request(base, '/api/me');
    assert.equal(me.status, 401);
  });
});

test('register, hash password, login and session authentication', async () => {
  await withServer(async base => {
    const created = await register(base, 'roman', 'roman@example.com');
    assert.equal(created.status, 201);
    assert.equal(created.data.user.username, 'roman');
    assert.equal('password' in created.data.user, false);

    const duplicate = await register(base, 'roman', 'other@example.com');
    assert.equal(duplicate.status, 409);

    const badLogin = await request(base, '/api/auth/login', { method: 'POST', body: { username: 'roman', password: 'wrongpass' } });
    assert.equal(badLogin.status, 401);

    const token = await login(base, 'roman');
    const me = await request(base, '/api/me', { token });
    assert.equal(me.status, 200);
    assert.equal(me.data.user.username, 'roman');
  });
});

test('friend request lifecycle and friend-only feed', async () => {
  await withServer(async base => {
    await register(base, 'alice', 'alice@example.com');
    await register(base, 'bob', 'bob@example.com');
    const alice = await login(base, 'alice');
    const bob = await login(base, 'bob');

    const post = await request(base, '/api/posts', { method: 'POST', token: bob, body: { title: 'Hello Mash', body: 'First post from Bob.' } });
    assert.equal(post.status, 201);

    let feed = await request(base, '/api/feed', { token: alice });
    assert.equal(feed.data.posts.length, 0);

    const sent = await request(base, '/api/friends/request', { method: 'POST', token: alice, body: { username: 'bob' } });
    assert.equal(sent.status, 201);

    let friends = await request(base, '/api/friends', { token: bob });
    assert.equal(friends.data.incoming[0].username, 'alice');

    const accepted = await request(base, '/api/friends/respond', { method: 'POST', token: bob, body: { username: 'alice', action: 'accept' } });
    assert.equal(accepted.status, 200);

    feed = await request(base, '/api/feed', { token: alice });
    assert.equal(feed.data.posts.length, 1);
    assert.equal(feed.data.posts[0].author.username, 'bob');
  });
});

test('messaging is restricted to friends and persists conversation', async () => {
  await withServer(async base => {
    await register(base, 'alice', 'alice@example.com');
    await register(base, 'bob', 'bob@example.com');
    await register(base, 'eve', 'eve@example.com');
    const alice = await login(base, 'alice');
    const bob = await login(base, 'bob');
    const eve = await login(base, 'eve');

    let denied = await request(base, '/api/messages', { method: 'POST', token: eve, body: { username: 'alice', body: 'Hi' } });
    assert.equal(denied.status, 403);

    await request(base, '/api/friends/request', { method: 'POST', token: alice, body: { username: 'bob' } });
    await request(base, '/api/friends/respond', { method: 'POST', token: bob, body: { username: 'alice', action: 'accept' } });

    const sent = await request(base, '/api/messages', { method: 'POST', token: alice, body: { username: 'bob', body: 'Hey Bob' } });
    assert.equal(sent.status, 201);

    const conversation = await request(base, '/api/messages/alice', { token: bob });
    assert.equal(conversation.status, 200);
    assert.equal(conversation.data.messages.length, 1);
    assert.equal(conversation.data.messages[0].body, 'Hey Bob');
  });
});

test('profile update and logout revoke session', async () => {
  await withServer(async base => {
    await register(base, 'roman', 'roman@example.com');
    const token = await login(base, 'roman');
    const updated = await request(base, '/api/me', { method: 'PATCH', token, body: { bio: 'IT student building systems.' } });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.user.bio, 'IT student building systems.');

    const logout = await request(base, '/api/auth/logout', { method: 'POST', token });
    assert.equal(logout.status, 200);
    const after = await request(base, '/api/me', { token });
    assert.equal(after.status, 401);
  });
});
