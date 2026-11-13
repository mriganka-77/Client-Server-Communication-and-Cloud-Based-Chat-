# phases.md — Implementation Roadmap

Each phase has a **goal, tasks, commands/notes, and an exit checklist**. Do not move on until the checklist passes.

| Phase | Name | Est. time |
|---|---|---|
| 0 | Planning & repo setup | 0.5 day |
| 1 | VirtualBox VMs & virtual network | 1 day |
| 2 | Backend development | 1.5 days |
| 3 | Frontend development | 1 day |
| 4 | Local client–server testing (VM ↔ VM) | 0.5 day |
| 5 | AWS EC2 deployment | 1 day |
| 6 | Hardening, testing & polish | 0.5 day |
| 7 | Documentation & demo | 1 day |

---

## Phase 0 — Planning & Repo Setup

**Goal:** Have the docs, repo and tooling ready.

- [ ] Finalise `PRD.md`, `design.md`, `architecture.md`, `phases.md`
- [ ] Create Git repo with the folder layout from `architecture.md`
- [ ] Add `.gitignore` (`node_modules`, `.env`, `data/`, `*.db`)
- [ ] Install VirtualBox 7.x and download Ubuntu 22.04 ISO
- [ ] Create AWS account, enable MFA, set a billing alarm

**Exit:** repo initialised, ISO downloaded, AWS account ready.

---

## Phase 1 — VirtualBox VMs & Virtual Network

**Goal:** Two Ubuntu VMs that can reach each other by static IP.

### Tasks

1. Create **Server VM** (`chat-server`, 2 GB RAM, 2 vCPU, 20 GB disk) and **Client VM** (`chat-client`, same, Ubuntu Desktop for a browser).
2. For each VM, set **Adapter 1 = NAT**, **Adapter 2 = Host-only Adapter** (or Internal Network `chatnet`).
3. Install Ubuntu on both; set hostnames.
4. Configure static IPs with Netplan on adapter 2:
   - Server `192.168.56.10/24`
   - Client `192.168.56.20/24`
5. Apply and verify:

```bash
sudo netplan apply
ip a                       # confirm 192.168.56.x on enp0s8
ping -c 4 192.168.56.20    # from server
ping -c 4 192.168.56.10    # from client
```

6. Install base tools on both: `sudo apt update && sudo apt install -y curl net-tools git ufw`
7. Install Node.js 20 on the **Server VM**:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v && npm -v
```

### Exit checklist
- [ ] Both VMs ping each other with 0 % loss
- [ ] Both VMs have internet through NAT (`ping 8.8.8.8`)
- [ ] Node.js installed on Server VM
- [ ] Screenshots: `ip a`, `ping` on both

---

## Phase 2 — Backend Development

**Goal:** Fully working server (REST + WebSocket + SQLite), testable without the UI.

### Tasks

1. `cd server && npm init -y && npm i express socket.io better-sqlite3 dotenv`
2. `config.js` — read env vars with defaults
3. `db.js` — create DB dir/file, run schema, `saveMessage`, `getRecentMessages(limit)`
4. `validators.js` — nickname + message validation
5. `rateLimiter.js` — simple per-socket counter/token bucket
6. `routes.js` — `/health`, `/api/messages`
7. `socket.js` — `join`, `message`, `typing`, `disconnect` per `design.md §9.1`
8. `index.js` — wire everything, serve `../client` as static, listen on `0.0.0.0`
9. Add `"scripts": {"start": "node index.js", "dev": "node --watch index.js", "test": "node --test"}`
10. Write unit tests for validators/rate limiter and one integration test with `socket.io-client`

### Quick verification

```bash
npm start
curl http://localhost:3000/health
curl "http://localhost:3000/api/messages?limit=10"
```

### Exit checklist
- [ ] `/health` returns `status: ok`
- [ ] Integration test: two socket clients exchange a message
- [ ] Duplicate nickname rejected; oversize message rejected
- [ ] Messages persist across a server restart
- [ ] Server listens on `0.0.0.0:3000` (`ss -tulnp | grep 3000`)

---

## Phase 3 — Frontend Development

**Goal:** Minimal UI matching `design.md`.

### Tasks

1. `index.html` — join form, chat view (header, message list, online panel, composer)
2. `style.css` — CSS variables, light/dark, responsive layout, bubbles
3. `app.js` — implement the function map from `design.md §8.2`
4. Load Socket.IO client from the server itself: `<script src="/socket.io/socket.io.js"></script>` (no CDN needed)
5. Implement status indicator, reconnect logic, typing indicator, smart scroll
6. Use `textContent` for all user-supplied strings

### Exit checklist
- [ ] Join → chat works on desktop and mobile width
- [ ] Two browser tabs chat in real time
- [ ] XSS test string renders as text
- [ ] Killing the server shows "Reconnecting…"; restarting restores the session

---

## Phase 4 — Local Client–Server Testing (VM ↔ VM)

**Goal:** Prove the core project requirement: Client VM talks to Server VM.

### Tasks

1. Copy the project to Server VM (`git clone` or `scp`):

```bash
scp -r chat-app user@192.168.56.10:~/
```

2. On Server VM:

```bash
cd ~/chat-app/server && cp .env.example .env && npm install
sudo ufw allow 22/tcp && sudo ufw allow 3000/tcp && sudo ufw enable
npm start
```

3. On Client VM:

```bash
ping -c 3 192.168.56.10
curl http://192.168.56.10:3000/health
nc -zv 192.168.56.10 3000
```

4. Open `http://192.168.56.10:3000` in the Client VM's browser. Open a second tab (or the host's browser via Host-only) and chat.
5. (Optional) Capture traffic with `sudo tcpdump -i enp0s8 port 3000` or Wireshark to show TCP handshake and WebSocket upgrade.
6. Set up systemd on the Server VM using `deploy/chat.service` so it survives reboot:

```bash
sudo cp deploy/chat.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now chat
sudo systemctl status chat
```

### Exit checklist
- [ ] Client VM browser loads the chat UI from `192.168.56.10:3000`
- [ ] Messages flow between Client VM and a second client
- [ ] Service restarts automatically after `kill` and after VM reboot
- [ ] Screenshots + `tcpdump`/Wireshark capture saved

---

## Phase 5 — AWS EC2 Deployment

**Goal:** Same server running in the cloud, reachable from anywhere.

### Tasks

1. **Launch instance**: Ubuntu 22.04, t2/t3.micro, 8 GB gp3, new key pair (`chat-key.pem`).
2. **Security group** (`chat-sg`) inbound:
   - SSH 22 → *My IP*
   - HTTP 80 → `0.0.0.0/0`
   - Custom TCP 3000 → *My IP* (testing only; remove later)
3. **Allocate and associate an Elastic IP.**
4. **SSH in:**

```bash
chmod 400 chat-key.pem
ssh -i chat-key.pem ubuntu@<ELASTIC_IP>
```

5. **Install runtime:**

```bash
sudo apt update && sudo apt install -y nginx git ufw
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

6. **Deploy code:**

```bash
git clone <your-repo-url> ~/chat-app
cd ~/chat-app/server && cp .env.example .env && npm install --omit=dev
# .env: HOST=127.0.0.1  PORT=3000  DB_PATH=/var/lib/chat/chat.db
sudo mkdir -p /var/lib/chat && sudo chown ubuntu:ubuntu /var/lib/chat
```

7. **systemd:** install `deploy/chat.service`, enable and start it.
8. **Nginx:** copy `deploy/nginx-chat.conf` to `/etc/nginx/sites-available/chat`, symlink to `sites-enabled`, remove `default`, then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

9. **UFW:** allow 22 and 80 (or `Nginx Full`), enable.
10. **Test:**

```bash
curl http://<ELASTIC_IP>/health
```

Then open `http://<ELASTIC_IP>` from the **Client VM**, your host and your phone, and chat across them.
11. (Optional) Add a domain/Route 53 record + HTTPS with `sudo certbot --nginx`.
12. Remove the port-3000 rule from the security group once Nginx works.

### Exit checklist
- [ ] `http://<ELASTIC_IP>` loads the chat UI from at least 3 different devices
- [ ] WebSocket connects (DevTools → Network → WS shows 101)
- [ ] Service survives `sudo reboot`
- [ ] Screenshots: EC2 console, security group, `systemctl status`, browser

---

## Phase 6 — Hardening, Testing & Polish

- [ ] Run the full acceptance test table from `PRD.md §9` (AT-1 … AT-9)
- [ ] Verify rate limiting and message length limits
- [ ] Confirm no `innerHTML` with user data (`grep -R innerHTML client/`)
- [ ] Confirm `.env` and DB are not in Git
- [ ] SSH: disable password auth (default on EC2); keep key-only
- [ ] Add DB backup one-liner (`sqlite3 chat.db ".backup backup.db"`) to the README
- [ ] Load sanity test: 30–50 concurrent socket clients via a small script
- [ ] Fix UI rough edges (mobile layout, scroll behaviour, dark mode)

---

## Phase 7 — Documentation & Demo

### Deliverables

- [ ] `README.md` with quick-start for both local and EC2
- [ ] Network diagram (local + cloud) and IP/port table
- [ ] Screenshot set (see `PRD.md §10`)
- [ ] Short report: architecture, networking concepts used (IP addressing, subnets, NAT vs Host-only, TCP, ports, firewalls, security groups), problems & fixes
- [ ] 3–5 minute demo video or live-demo script:
  1. Show VM IPs and `ping`
  2. Show Client VM using the local server
  3. Show EC2 instance and security group
  4. Show Client VM using the EC2-hosted server
  5. Show persistence and auto-restart

### Cost cleanup (after grading)

- [ ] Stop/terminate EC2, **release the Elastic IP**, delete unused EBS volumes

---

## Suggested Timeline (7 days)

| Day | Focus |
|---|---|
| 1 | Phase 0 + Phase 1 |
| 2–3 | Phase 2 |
| 4 | Phase 3 |
| 5 | Phase 4 + start Phase 5 |
| 6 | Finish Phase 5 + Phase 6 |
| 7 | Phase 7 |

## Troubleshooting Cheatsheet

| Symptom | Check |
|---|---|
| VMs can't ping | Both on same Host-only/Internal network? IPs in same /24? |
| `Connection refused` on :3000 | Server running? Bound to `0.0.0.0`? `ss -tulnp \| grep 3000` |
| Timeout (not refused) | UFW or security group blocking the port |
| UI loads but chat doesn't connect behind Nginx | Missing `Upgrade`/`Connection` headers |
| EC2 IP changed after restart | Use an Elastic IP |
| `better-sqlite3` install fails | `sudo apt install -y build-essential python3` then reinstall |
