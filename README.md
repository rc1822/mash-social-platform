# Mash Social Platform

A rebuilt full-stack version of **Mash**, a social-media project centered on profiles, posts, friend connections, direct messaging, and short-form video.

This version replaces the original browser-only prototype architecture with a persistent backend, authenticated REST API, hashed passwords, revocable sessions, and relational data stored in SQLite.

## Why I rebuilt it

The first version demonstrated the product concept, but account credentials and application data were stored in browser `localStorage`. For a portfolio version, I rebuilt the application around a real server and database so the security and architecture better reflect production-style web development.

## Features

- Account registration and login
- Password hashing with Node.js `crypto.scrypt`
- Random bearer-session tokens stored as SHA-256 hashes in the database
- Session expiration and logout revocation
- SQLite persistence
- Protected REST API routes
- User profiles, bios, and profile images
- Create image/text posts
- Feed containing your posts and friends' posts
- User search
- Friend requests, accept/decline, and removal
- Direct messaging restricted to friends
- Mash Minis short-form video viewer
- Responsive desktop/mobile UI
- Docker support
- GitHub Actions test workflow
- Automated API integration tests

## Architecture

```text
Browser UI
   |
   | HTTPS / JSON REST API
   v
Node.js HTTP Server
   |
   +-- Authentication / Sessions
   +-- Users / Profiles
   +-- Posts / Feed
   +-- Friend Requests / Friendships
   +-- Direct Messages
   |
   v
SQLite Database
```

The application intentionally uses Node's built-in HTTP, crypto, test, and SQLite capabilities, keeping the project dependency-free while still implementing the full client/server architecture.

## Security improvements over the prototype

| Area | Rebuilt version |
| --- | --- |
| Password storage | `scrypt` salted password hashes |
| Login state | Random revocable session tokens |
| Session storage | Only token hashes are stored server-side |
| Database access | Parameterized SQLite statements |
| Protected data | Authentication required for social API routes |
| Messaging | Restricted to accepted friends |
| Input | Length/type validation and request-size limits |
| Frontend rendering | User-generated text is HTML-escaped |
| Secrets | No credentials or API keys committed to the repository |

## Run locally

### Requirements

- Node.js 22.5 or newer

No third-party packages are required.

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

The SQLite database is created automatically at `data/mash.db`.

### Development mode

```bash
npm run dev
```

### Tests

```bash
npm test
```

The integration suite covers authentication, access control, friend requests, feed visibility, messaging, profile updates, and session revocation.

## Docker

```bash
docker compose up --build
```

Open `http://localhost:3000`. Application data is persisted in a Docker volume.

## API overview

```text
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/me
PATCH  /api/me
GET    /api/users?q=<username>
GET    /api/feed
POST   /api/posts
GET    /api/friends
POST   /api/friends/request
POST   /api/friends/respond
DELETE /api/friends/:username
GET    /api/messages/:username
POST   /api/messages
GET    /api/health
```

## Project structure

```text
mash-social-platform/
├── public/               # Responsive browser UI and media
│   ├── assets/
│   ├── videos/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── src/
│   ├── app.js            # REST API and static server
│   ├── db.js             # SQLite schema and database setup
│   ├── security.js       # Password hashing and sessions
│   └── server.js         # HTTP server entry point
├── test/
│   └── app.test.js       # Integration tests
├── .github/workflows/
│   └── test.yml
├── compose.yaml
├── Dockerfile
└── package.json
```

## Portfolio talking points

This project demonstrates:

- converting a frontend prototype into a full-stack system;
- designing relational schemas for users, posts, friendships, requests, sessions, and messages;
- authentication and authorization fundamentals;
- REST API design;
- secure password and session handling;
- persistent application state with SQLite;
- automated integration testing;
- containerization and CI.

## Future improvements

- WebSocket real-time messaging and notifications
- Object storage for uploaded images/videos instead of database data URLs
- Password reset and email verification
- CSRF protection if authentication moves to cookies
- Pagination for feeds and conversations
- Rate limiting backed by Redis
- Moderation/reporting features
- Multi-instance deployment behind a reverse proxy

## License

MIT
