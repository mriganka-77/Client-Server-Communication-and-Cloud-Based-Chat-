# architecture.md — System Architecture

## 1. Architecture Style

**Client–Server, event-driven, single-tier backend.**

- **Client**: browser running static HTML/CSS/JS (no build step)
- **Server**: Node.js process serving static files + REST endpoints + WebSocket events
- **Storage**: SQLite file on the server's disk
- **Transport**: HTTP/1.1 for page load and REST; WebSocket (via Socket.IO) for real-time messaging over TCP

## 2. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Runtime | Node.js 20 LTS | Simple, great WebSocket support |
| Web framework | Express 4 | Minimal, static + REST |
| Realtime | Socket.IO 4 | Auto-reconnect, rooms, fallbacks |
| Database | SQLite via `better-sqlite3` | Zero-config, file-based, ideal for demo |
| Frontend | Vanilla HTML/CSS/JS | Minimal UI, no build tooling |
| Reverse proxy | Nginx (EC2) | Port 80, WebSocket upgrade, later TLS |
| Process manager | systemd (or PM2) | Auto-start and auto-restart |
| Firewall | UFW + EC2 Security Group | Defense in depth |
| Cloud | AWS EC2 (Ubuntu 22.04) | Required by project |

## 3. High-Level Diagram

### 3.1 Local (VirtualBox) deployment

```
                    HOST MACHINE (VirtualBox)
 ┌────────────────────────────────────────────────────────────┐
 │                                                            │
 │   ┌──────────────────┐            ┌──────────────────┐     │
 │   │   CLIENT VM      │            │   SERVER VM      │     │
 │   │  Ubuntu Desktop  │            │  Ubuntu Server   │     │
 │   │                  │            │                  │     │
 │   │  Browser         │   HTTP +   │  Node.js :3000   │     │
 │   │  (chat UI)       │◄──────────►│  Express         │     │
 │   │                  │ WebSocket  │  Socket.IO       │     │
 │   │ 192.168.56.20    │            │  SQLite (chat.db)│     │
 │   └────────┬─────────┘            └────────┬─────────┘     │
 │            │      Host-only network         │              │
 │            └────────── 192.168.56.0/24 ─────┘              │
 └────────────────────────────────────────────────────────────┘
        (each VM also has a NAT adapter for apt/npm internet access)
```

### 3.2 Cloud (EC2) deployment

```
 Browser (Client VM / host / phone)
        │  http://<Elastic-IP>
        ▼
 ┌──────────── AWS Region ────────────────────────────────┐
 │  Internet Gateway                                      │
 │        │                                               │
 │  ┌─────▼───────── VPC (default) ───────────────────┐   │
 │  │  Security Group: 22 (my IP), 80, 443            │   │
 │  │  ┌───────────── EC2 (Ubuntu 22.04) ──────────┐  │   │
 │  │  │  Nginx :80 ──proxy──► Node.js :3000       │  │   │
 │  │  │                        │                  │  │   │
 │  │  │                   SQLite chat.db (EBS)    │  │   │
 │  │  └───────────────────────────────────────────┘  │   │
 │  └─────────────────────────────────────────────────┘   │
 └────────────────────────────────────────────────────────┘
```

## 4. Component Breakdown

### 4.1 Frontend (`client/`)

| File | Responsibility |
|---|---|
| `index.html` | Join screen + chat screen markup |
| `style.css` | Minimal responsive styling, light/dark via CSS variables |
| `app.js` | Socket.IO client, DOM rendering, validation, reconnect handling |

### 4.2 Backend (`server/`)

| Module | Responsibility |
|---|---|
| `index.js` | Bootstrap: Express app, HTTP server, Socket.IO attach, start listening on `0.0.0.0:PORT` |
| `config.js` | Reads env vars (`PORT`, `DB_PATH`, `CORS_ORIGIN`, `HISTORY_LIMIT`) |
| `db.js` | Opens SQLite, creates schema, exposes `saveMessage()` and `getRecentMessages()` |
| `routes.js` | REST: `/health`, `/api/messages` |
| `socket.js` | Socket.IO event handlers (join, message, typing, disconnect) |
| `validators.js` | Nickname/message validation and sanitising |
| `rateLimiter.js` | Per-socket token bucket |

## 5. Communication Design

### 5.1 Connection lifecycle

```
Client                                   Server
  │── HTTP GET / ─────────────────────────►│  serve index.html, css, js
  │◄────────────────────────── 200 OK ─────│
  │── WS handshake (HTTP Upgrade) ────────►│
  │◄──────────────────────── 101 Switching ─│
  │── emit "join" {username} ─────────────►│  validate, check uniqueness
  │◄── "join:ok" {history[], users[]} ─────│
  │◄── "system" "alice joined" (broadcast) │
  │── emit "message" {content} ───────────►│  validate, rate-limit, save to DB
  │◄── "message" {id,username,content,ts} ─│  (broadcast to all)
  │── (close tab) ────────────────────────►│  "disconnect"
  │                                        │──► broadcast "system" + "users"
```

### 5.2 Socket event contract

| Direction | Event | Payload | Notes |
|---|---|---|---|
| C → S | `join` | `{ username }` | Ack callback returns `{ok, error?}` |
| S → C | `join:ok` | `{ username, history: Message[], users: string[] }` | Sent only to joiner |
| C → S | `message` | `{ content }` | Ack returns `{ok, error?}` |
| S → C | `message` | `{ id, username, content, createdAt }` | Broadcast |
| C → S | `typing` | `{ isTyping: boolean }` | Optional |
| S → C | `typing` | `{ username, isTyping }` | To others |
| S → C | `users` | `string[]` | Whenever list changes |
| S → C | `system` | `{ text, createdAt }` | Join/leave notices |
| S → C | `error:msg` | `{ code, message }` | Validation/rate-limit errors |

### 5.3 REST API

| Method | Path | Response |
|---|---|---|
| GET | `/health` | `200 {"status":"ok","uptime":123.4,"connections":3}` |
| GET | `/api/messages?limit=50` | `200 [{id,username,content,createdAt}]` |

## 6. Data Model

```sql
CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT    NOT NULL,
  content     TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
```

Online users live **in memory only**: `Map<socketId, username>`.

## 7. Network Architecture

### 7.1 Local VirtualBox network plan

| Setting | Server VM | Client VM |
|---|---|---|
| Adapter 1 | NAT | NAT |
| Adapter 2 | Host-only (`vboxnet0`) or Internal Network `chatnet` | Same network |
| IP (adapter 2) | `192.168.56.10/24` | `192.168.56.20/24` |
| Gateway | none needed (same subnet) | none needed |
| Listening | `0.0.0.0:3000` | — |

**Netplan example** (`/etc/netplan/01-chat.yaml`, second NIC usually `enp0s8`):

```yaml
network:
  version: 2
  ethernets:
    enp0s3:
      dhcp4: true            # NAT adapter, internet
    enp0s8:
      dhcp4: false
      addresses: [192.168.56.10/24]   # use .20 on the Client VM
```

Apply: `sudo netplan apply` → verify with `ip a` and `ping 192.168.56.10`.

> Use **Internal Network** if you want the VMs isolated from the host; use **Host-only** if you also want to browse from the host machine.

### 7.2 Port map

| Port | Protocol | Purpose | Where |
|---|---|---|---|
| 22 | TCP | SSH | VM + EC2 (restricted to your IP on EC2) |
| 80 | TCP | Nginx → app | EC2 |
| 443 | TCP | HTTPS (optional) | EC2 |
| 3000 | TCP | Node.js app | VM (direct), EC2 (localhost only behind Nginx) |

### 7.3 Firewall

```bash
# UFW on Server VM
sudo ufw allow 22/tcp
sudo ufw allow 3000/tcp
sudo ufw enable

# UFW on EC2 (Nginx in front)
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw enable
```

### 7.4 Nginx reverse proxy (EC2)

```nginx
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }
}
```

## 8. Deployment Architecture

### 8.1 Folder layout

```
chat-app/
├── server/
│   ├── index.js
│   ├── config.js
│   ├── db.js
│   ├── routes.js
│   ├── socket.js
│   ├── validators.js
│   ├── rateLimiter.js
│   ├── package.json
│   └── .env.example
├── client/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── deploy/
│   ├── chat.service        # systemd unit
│   └── nginx-chat.conf
└── docs/  (PRD.md, design.md, architecture.md, phases.md)
```

### 8.2 systemd unit (`deploy/chat.service`)

```ini
[Unit]
Description=Chat App Server
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/chat-app/server
EnvironmentFile=/home/ubuntu/chat-app/server/.env
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

### 8.3 Environment variables

| Variable | Local | EC2 |
|---|---|---|
| `PORT` | 3000 | 3000 |
| `HOST` | 0.0.0.0 | 127.0.0.1 (Nginx fronts it) |
| `DB_PATH` | `./data/chat.db` | `/var/lib/chat/chat.db` |
| `CORS_ORIGIN` | `*` | your domain / EC2 IP |
| `HISTORY_LIMIT` | 50 | 50 |

## 9. Security Architecture

| Threat | Control |
|---|---|
| XSS | Render with `textContent` (never `innerHTML`); server also trims/limits |
| Spam / flooding | Per-socket rate limit; max message length |
| Impersonation | Server-enforced unique nicknames (no auth, by design) |
| Open ports | UFW + Security Group; SSH limited to your IP; key-based login only |
| Secrets leakage | `.env` in `.gitignore`; no credentials needed in this app |
| Plain-text traffic | Optional Let's Encrypt via Certbot when a domain is attached |

## 10. Scalability Notes (future)

- Replace SQLite with PostgreSQL / RDS
- Add Redis adapter for Socket.IO to scale across multiple instances
- Put an Application Load Balancer with sticky sessions in front
- Containerise with Docker

## 11. Observability

- `/health` endpoint for uptime checks
- `journalctl -u chat -f` for logs on both VM and EC2
- Server logs: connect, join, disconnect, rate-limit events (no message content in logs)
- Optional: CloudWatch basic metrics on EC2
