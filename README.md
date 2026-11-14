# LANChat — Authenticated & End-to-End Encrypted (E2EE) Chat Application

> A secure, real-time messaging application built with **Node.js, Express, Socket.IO, Web Crypto API, and SQLite** featuring **user authentication, 1-on-1 direct E2EE messaging, and multi-user E2EE group chats**.

---

## 🔐 Security & Cryptographic Architecture

LANChat implements **Zero-Knowledge End-to-End Encryption (E2EE)** using the native browser **Web Crypto API (`window.crypto.subtle`)**:

```
[ Alice's Browser ]                                              [ Bob's Browser ]
  │                                                                │
  ├─ 1. Generate ECDH Keypair (P-256)                              ├─ 1. Generate ECDH Keypair (P-256)
  ├─ 2. Derive Shared AES-GCM-256 Key <───────────────────────────>├─ 2. Derive Same Shared Key
  │    (Alice PrivKey + Bob PubKey)                                │    (Bob PrivKey + Alice PubKey)
  │                                                                │
  ├─ 3. Encrypt: AES-GCM-256 (Fresh IV)                            │
  │     Ciphertext: "4rT7yK...=="                                  │
  │     IV: "dGhpcy...=="                                          │
  │                │                                               │
  │                ▼                                               │
  │         [ Node.js Server & SQLite DB ]                         │
  │         (ONLY sees ciphertext & IV;                            │
  │          Zero access to plaintext or keys!)                    │
  │                │                                               │
  │                └──────────────────────────────────────────────►├─ 4. Decrypt with Shared Key
  │                                                                │     Plaintext: "Hello Bob!"
```

### 1. User Authentication
- **Secure Password Hashing**: Passwords hashed on the backend using `crypto.scryptSync` with a cryptographically secure 16-byte random salt and 64-byte key length.
- **Session Tokens**: Authenticated via 32-byte cryptographic session tokens for REST requests and Socket.IO handshakes.

### 2. 1-on-1 Direct Messaging (E2EE)
- **Key Agreement**: **ECDH (Elliptic Curve Diffie-Hellman) over NIST P-256**.
- **Message Encryption**: **AES-256-GCM** with a distinct 12-byte initialization vector (IV) per message.
- **Zero-Knowledge Server**: The server only stores `{ ciphertext, iv }`. No third party (including the server or other users) can read the plaintext.

### 3. Multi-User Group Chats (E2EE)
- **Group Key Generation**: Group creator's browser generates a random 256-bit AES-GCM group key.
- **Key Distribution**: The group key is individually encrypted for each member using their pairwise ECDH shared key.
- **Group Messages**: Encrypted using the group's symmetric AES-GCM key with fresh IVs. Only authorized group members possessing the group key can decrypt messages.

---

## 📁 Repository Structure

```
.
├── client/                     # Frontend Web App (Vanilla JS, Web Crypto API, HTML5, CSS3)
│   ├── index.html              # Auth tabs (Login/Register), Sidebar, Direct & Group Chat UI, Modal
│   ├── style.css               # Modern dark/light responsive layout & security badges
│   ├── crypto.js               # Web Crypto API wrapper (ECDH P-256, AES-256-GCM, key serialization)
│   └── app.js                  # Socket.IO connection, room navigation, E2EE message encryption/decryption
├── server/                     # Backend (Node.js + Express + Socket.IO + SQLite)
│   ├── index.js                # Server entry point & static file server
│   ├── config.js               # Environment variables config
│   ├── db.js                   # Dual-engine SQLite persistence (users, sessions, rooms, encrypted messages)
│   ├── auth.js                 # Password hashing (scrypt) & secure session token generation
│   ├── routes.js               # REST API (/api/auth/*, /api/users, /api/rooms/*, /health)
│   ├── socket.js               # Authenticated WebSocket events & real-time delivery
│   ├── validators.js           # Nickname & message validation
│   ├── rateLimiter.js          # Token bucket sliding-window rate limiter
│   ├── tests/                  # Automated unit and integration test suite
│   ├── package.json
│   ├── .env.example
│   └── .env
├── deploy/                     # Deployment configurations
│   ├── chat.service            # systemd unit for automatic process management
│   └── nginx-chat.conf         # Nginx reverse proxy with WebSocket upgrade support
└── README.md
```

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
cd server
npm install
```

### 2. Run Test Suite
```bash
npm test
```
*(All 10/10 automated tests pass).*

### 3. Start the Server
```bash
npm start
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🧪 Testing E2EE & Group Chats

1. **Open two tabs / windows**:
   - Tab 1: Click **Create Account** and register as `alice` (Password: e.g. `Password123!`).
   - Tab 2 (Incognito / separate browser): Register as `bob` (Password: e.g. `Password123!`).
2. **1-on-1 Direct Chat**:
   - In Alice's tab, click `bob` under **Direct Messages**.
   - Send an encrypted message: only Alice and Bob can decrypt it.
   - Inspect the SQLite database or network traffic: you will see only Base64 ciphertext (`ciphertext` and `iv`).
3. **Group Chat**:
   - Click **+ New Group**, enter a name (e.g. `Security Team`), and select `bob`.
   - The creator automatically generates an AES-256 group key and encrypts it specifically for Bob using ECDH.
   - Both Alice and Bob can converse in the encrypted group, while any third user cannot access or decrypt group messages.
