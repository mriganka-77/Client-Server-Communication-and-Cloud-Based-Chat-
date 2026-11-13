# LANChat — Client–Server Communication & Cloud-Based Chat Application

> A real-time chat application built with **Node.js, Express, Socket.IO, and SQLite** to demonstrate **client-server architecture, virtual networking (VirtualBox Host-only networking), and cloud deployment (AWS EC2)**.

---

## 📁 Repository Structure

```
.
├── client/                     # Frontend (Vanilla HTML, CSS, JavaScript)
│   ├── index.html              # Responsive join and chat views
│   ├── style.css               # Clean styling with light/dark themes
│   └── app.js                  # Socket.IO client, DOM rendering, auto-scroll & typing
├── server/                     # Backend (Node.js + Express + Socket.IO + SQLite)
│   ├── index.js                # App entrypoint and HTTP/Socket.IO listener
│   ├── config.js               # Environment variables configuration
│   ├── db.js                   # Dual-engine SQLite persistence (better-sqlite3 / node:sqlite)
│   ├── routes.js               # REST API endpoints (/health, /api/messages)
│   ├── socket.js               # Real-time WebSocket event lifecycle & state
│   ├── validators.js           # Nickname & message validation and XSS prevention
│   ├── rateLimiter.js          # Per-socket token bucket rate limiting (max 5 msgs/3s)
│   ├── tests/                  # Unit and integration test suite
│   ├── package.json
│   ├── .env.example
│   └── .env
├── deploy/                     # Production & VM deployment configs
│   ├── chat.service            # systemd service unit for 24/7 uptime & auto-restart
│   └── nginx-chat.conf         # Nginx reverse proxy & WebSocket upgrade configuration
├── PRD.md                      # Product Requirements Document
├── architecture.md             # System & network architecture specification
├── design.md                   # UI/UX & backend detailed design specification
└── phases.md                   # Step-by-step implementation roadmap
```

---

## 🚀 Quick Start (Local Run)

### 1. Install Dependencies
```bash
cd server
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```
Default `.env` configuration:
```env
PORT=3000
HOST=0.0.0.0
DB_PATH=./data/chat.db
CORS_ORIGIN=*
HISTORY_LIMIT=50
```

### 3. Run Tests
```bash
npm test
```

### 4. Start the Server
```bash
npm start
# or development mode with file watching:
npm run dev
```

Open `http://localhost:3000` in multiple browser tabs or devices on your local network.

---

## 🖥️ Environment 1: Local VirtualBox Setup (VM ↔ VM)

### 1. Network Topology
- **Server VM** (Ubuntu Server 22.04 LTS):
  - Adapter 1: `NAT` (Internet access for apt/npm)
  - Adapter 2: `Host-only Adapter` (`vboxnet0`) with static IP: `192.168.56.10/24`
- **Client VM** (Ubuntu Desktop 22.04 LTS):
  - Adapter 1: `NAT`
  - Adapter 2: `Host-only Adapter` (`vboxnet0`) with static IP: `192.168.56.20/24`

### 2. Netplan Configuration (`/etc/netplan/01-chat.yaml` on Server VM)
```yaml
network:
  version: 2
  ethernets:
    enp0s3:
      dhcp4: true
    enp0s8:
      dhcp4: false
      addresses: [192.168.56.10/24]
```
Apply on both VMs:
```bash
sudo netplan apply
ping 192.168.56.10   # from Client VM to verify connectivity
```

### 3. Server VM Firewall & Service Setup
```bash
sudo ufw allow 22/tcp
sudo ufw allow 3000/tcp
sudo ufw enable

# Run as background systemd service:
sudo cp deploy/chat.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now chat
```
Access the application from the Client VM browser at: `http://192.168.56.10:3000`.

---

## ☁️ Environment 2: AWS EC2 Cloud Deployment

### 1. AWS Infrastructure Setup
1. Launch an **Ubuntu 22.04 LTS** instance (`t2.micro` or `t3.micro`).
2. Attach an **Elastic IP** to maintain a persistent public IP address.
3. Configure the **Security Group**:
   - `SSH (22)`: Your IP only
   - `HTTP (80)`: `0.0.0.0/0` (Anywhere)
   - `Custom TCP (3000)`: Your IP (optional for initial debugging)

### 2. Deploy on EC2
```bash
# Update and install Nginx & Node.js 20 LTS
sudo apt update && sudo apt install -y nginx git ufw
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Clone repo and setup database directory
git clone <your-repo> ~/chat-app
cd ~/chat-app/server
cp .env.example .env
npm install --omit=dev

sudo mkdir -p /var/lib/chat && sudo chown ubuntu:ubuntu /var/lib/chat

# Setup systemd service
sudo cp ~/chat-app/deploy/chat.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now chat

# Setup Nginx Reverse Proxy (with WebSocket upgrade support)
sudo cp ~/chat-app/deploy/nginx-chat.conf /etc/nginx/sites-available/chat
sudo ln -s /etc/nginx/sites-available/chat /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Enable firewall
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw enable
```

Test by opening `http://<YOUR_ELASTIC_IP>` in any web browser or phone.

---

## 🛡️ Security & Architecture Features

- **XSS Prevention**: DOM messages are rendered strictly via `element.textContent` (no `innerHTML` used with untrusted input).
- **Spam & Flooding Protection**: Token-bucket sliding window rate-limiter restricts sockets to a maximum of 5 messages per 3 seconds.
- **Input Sanitization**: User nicknames and message lengths are strictly enforced on both client and server sides.
- **Fault-Tolerant Persistence**: All chat messages are immediately persisted into indexed SQLite storage (`chat.db`).
