# PRD — Client–Server Communication & Cloud-Based Chat Application

| Field | Value |
|---|---|
| Version | 1.0 |
| Type | Academic / networking + cloud project |
| Status | Draft |

---

## 1. Overview

A minimal real-time chat web application used to **demonstrate client-server architecture, virtual networking, IP addressing and cloud deployment**. Users open a website, pick a nickname, and exchange messages with everyone else in a shared room.

The same server code runs in two environments:

1. **Local** — two Ubuntu VMs in VirtualBox (Server VM and Client VM) communicating over a virtual network.
2. **Cloud** — the server deployed on an Amazon EC2 instance, reached over the public internet.

## 2. Goals

| # | Goal |
|---|---|
| G1 | Working real-time chat between multiple browsers |
| G2 | Prove client-to-server communication between two VirtualBox VMs using static IPs |
| G3 | Deploy the same backend on EC2 and chat through its public IP / DNS |
| G4 | Document the networking (IP, ports, subnet, firewall) so it can be explained in a viva/demo |
| G5 | Keep the UI minimal and the code readable |

## 3. Non-Goals

- No user registration, passwords, OAuth, or email verification
- No file/image sharing, voice or video
- No end-to-end encryption
- No horizontal scaling / load balancing
- No mobile native apps (responsive web only)

## 4. Target Users

| Persona | Need |
|---|---|
| **Chat user** | Join quickly, send/receive messages instantly |
| **Student / evaluator** | See and understand how client, server, network and cloud fit together |

## 5. User Stories

| ID | Story | Priority |
|---|---|---|
| US-1 | As a user, I enter a nickname and join the chat room | Must |
| US-2 | As a user, I send a message and everyone sees it instantly | Must |
| US-3 | As a user, I see past messages when I join | Must |
| US-4 | As a user, I see who is online | Should |
| US-5 | As a user, I see join/leave notifications | Should |
| US-6 | As a user, I see "X is typing…" | Could |
| US-7 | As an admin, I can hit `/health` to verify the server is up | Must |
| US-8 | As a user, I see a clear status when disconnected and auto-reconnect | Should |

## 6. Functional Requirements

| ID | Requirement |
|---|---|
| FR-1 | The server serves the static frontend over HTTP |
| FR-2 | Clients connect via WebSocket (Socket.IO) |
| FR-3 | Nickname: 2–20 chars, alphanumeric/underscore, must be unique among online users |
| FR-4 | Message: 1–500 chars, trimmed, HTML-escaped on render |
| FR-5 | Server broadcasts each message to all connected clients with `username`, `content`, `timestamp` |
| FR-6 | Server persists every message in SQLite |
| FR-7 | On join, the client receives the last 50 messages |
| FR-8 | Server maintains and broadcasts the online-user list |
| FR-9 | Server emits system messages on join/leave |
| FR-10 | `GET /health` returns `{status:"ok", uptime, connections}` |
| FR-11 | `GET /api/messages?limit=50` returns recent messages as JSON |
| FR-12 | Basic rate limit: max 5 messages / 3 seconds per socket |
| FR-13 | Server config (port, DB path, CORS origin) comes from environment variables |

## 7. Non-Functional Requirements

| Area | Requirement |
|---|---|
| Latency | Message delivery < 200 ms on LAN, < 500 ms via EC2 |
| Capacity | ≥ 50 concurrent connections on a t2/t3.micro |
| Availability | Process auto-restarts on crash and on reboot (systemd/PM2) |
| Security | Input validation, output escaping, security group + UFW restricting ports, no secrets in repo |
| Portability | Same code runs unchanged on VM and EC2 |
| Usability | UI works on desktop and mobile widths; no framework needed |

## 8. Infrastructure Requirements

### 8.1 VirtualBox environment

| Item | Server VM | Client VM |
|---|---|---|
| OS | Ubuntu Server/Desktop 22.04 LTS | Ubuntu Desktop 22.04 LTS |
| Role | Runs Node.js chat server | Runs browser, connects to server |
| Adapter 1 | NAT (internet for apt/npm) | NAT |
| Adapter 2 | Host-only / Internal Network | Host-only / Internal Network |
| Static IP | `192.168.56.10` | `192.168.56.20` |
| RAM / CPU | 2 GB / 2 vCPU | 2 GB / 2 vCPU |

### 8.2 AWS environment

| Item | Value |
|---|---|
| Service | Amazon EC2 |
| AMI | Ubuntu 22.04 LTS |
| Type | t2.micro / t3.micro (free-tier eligible) |
| Public address | Elastic IP (recommended) |
| Security group inbound | 22 (My IP), 80 (0.0.0.0/0), 443 (optional), 3000 (testing only) |

## 9. Success Criteria / Acceptance Tests

| ID | Test | Expected |
|---|---|---|
| AT-1 | Client VM pings Server VM | 0% packet loss |
| AT-2 | Client VM browser opens `http://192.168.56.10:3000` | Chat UI loads |
| AT-3 | Two browsers chat on local setup | Messages appear on both instantly |
| AT-4 | Restart server, rejoin | History still present |
| AT-5 | Open `http://<EC2-IP>` from host machine and phone | Chat UI loads |
| AT-6 | Client VM and host chat through EC2 | Messages are shared |
| AT-7 | Duplicate nickname | Rejected with clear error |
| AT-8 | `<script>` in a message | Displayed as text, not executed |
| AT-9 | Kill the Node process | Auto-restarted within 5 s |

## 10. Deliverables

1. Source code (`server/`, `client/`)
2. Documentation: `PRD.md`, `design.md`, `architecture.md`, `phases.md`
3. Network diagram + IP table (local and cloud)
4. Screenshots: `ip a`, `ping`, `ss -tulnp`, browser on Client VM, EC2 console, security group
5. Demo video or live demo
6. Short report (problems faced, learnings)

## 11. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| VMs cannot reach each other | Use Host-only or Internal Network; verify with `ping`; check UFW |
| NAT-only adapter blocks inbound | Add a second adapter (Host-only/Bridged) |
| EC2 unreachable | Check security group, UFW, service listening on `0.0.0.0` |
| Public IP changes on stop/start | Attach an Elastic IP |
| AWS cost surprise | Free-tier instance, stop/terminate after demo, set billing alarm |
| WebSocket blocked behind proxy | Nginx `Upgrade`/`Connection` headers configured |

## 12. Assumptions & Dependencies

- Host machine has ≥ 8 GB RAM and VirtualBox 7.x installed
- AWS account with free-tier access
- Node.js 20 LTS, npm, Nginx available via apt/NodeSource
