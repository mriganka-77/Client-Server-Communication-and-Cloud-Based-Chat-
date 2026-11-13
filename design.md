# design.md — UI/UX & Detailed Design

## 1. Design Principles

1. **Minimal** — one page, two states (join / chat), zero dependencies besides Socket.IO client.
2. **Clear** — message sender, time and system events are instantly distinguishable.
3. **Resilient** — connection status is always visible; reconnect is automatic.
4. **Accessible** — semantic HTML, sufficient contrast, keyboard-first (Enter to send).
5. **Responsive** — usable from 320 px to desktop.

## 2. Screens

### 2.1 Join screen

```
┌──────────────────────────────────────┐
│                                      │
│              💬  LANChat             │
│        Cloud-based chat demo         │
│                                      │
│    ┌────────────────────────────┐    │
│    │ Enter a nickname           │    │
│    └────────────────────────────┘    │
│    (2–20 letters, numbers, _)        │
│                                      │
│    [        Join chat        ]       │
│                                      │
│    error message appears here        │
└──────────────────────────────────────┘
```

### 2.2 Chat screen

```
┌─────────────────────────────────────────────────────┐
│ 💬 LANChat            ● Connected     3 online  [≡] │  ← header
├───────────────────────────────────┬─────────────────┤
│ — alice joined —                  │ Online          │
│                                   │ • alice (you)   │
│ alice               10:41         │ • bob           │
│ ┌───────────────────────┐         │ • carol         │
│ │ Hello everyone!       │         │                 │
│ └───────────────────────┘         │                 │
│                    bob   10:42    │                 │
│          ┌─────────────────────┐  │                 │
│          │ Hi alice 👋          │  │                 │
│          └─────────────────────┘  │                 │
│ bob is typing…                    │                 │
├───────────────────────────────────┴─────────────────┤
│ ┌───────────────────────────────────────┐ [ Send ]  │
│ │ Type a message…                       │           │
│ └───────────────────────────────────────┘           │
└─────────────────────────────────────────────────────┘
```

- **Mobile**: the Online panel collapses behind the `≡` button.
- Own messages: right-aligned, accent colour. Others: left-aligned, neutral.
- System messages: centered, small, muted.

## 3. Visual Design

### 3.1 Colour tokens (CSS variables, light + dark)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f5f6f8` | `#12141a` | Page background |
| `--surface` | `#ffffff` | `#1c1f27` | Cards, header, input |
| `--text` | `#1a1d23` | `#e8eaf0` | Primary text |
| `--muted` | `#6b7280` | `#9aa1b0` | Timestamps, system text |
| `--accent` | `#2563eb` | `#3b82f6` | Buttons, own bubbles |
| `--accent-text` | `#ffffff` | `#ffffff` | Text on accent |
| `--border` | `#e5e7eb` | `#2a2e39` | Dividers |
| `--ok` | `#16a34a` | `#22c55e` | Connected dot |
| `--warn` | `#d97706` | `#f59e0b` | Reconnecting dot |
| `--err` | `#dc2626` | `#ef4444` | Error / disconnected |

Dark mode via `@media (prefers-color-scheme: dark)`.

### 3.2 Typography

- Font stack: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
- Base 16 px; message text 15 px; meta (time/name) 12 px
- Line-height 1.45

### 3.3 Spacing & shape

- 4 px spacing scale (4 / 8 / 12 / 16 / 24)
- Bubble radius 14 px; input and buttons 10 px
- Max bubble width 75 % of the message pane

## 4. Components

| Component | States | Notes |
|---|---|---|
| Nickname input | default, focus, invalid | Inline error text below |
| Join button | default, disabled (while joining) | Enter key submits |
| Status indicator | connected / reconnecting / disconnected | Coloured dot + label |
| Message bubble | own, other | Name, text, time |
| System line | — | Italic, muted, centered |
| Typing indicator | hidden / visible | Debounced, hides after 2 s of silence |
| Online list | — | Highlights "(you)" |
| Composer | enabled, disabled (offline) | `Enter` sends, `Shift+Enter` newline |
| Toast / banner | error | Used for rate-limit and validation errors |

## 5. Interaction Design

| Action | Behaviour |
|---|---|
| Submit nickname | Emit `join` → on success show chat; on failure show inline error |
| Send message | Trim; ignore empty; emit `message`; clear input; keep focus |
| Receive message | Append; auto-scroll **only if** user is already near the bottom |
| Scroll up | Pause auto-scroll; show "↓ New messages" pill when new ones arrive |
| Connection lost | Status → "Reconnecting…", composer disabled |
| Connection restored | Auto re-emit `join` with the stored nickname; reload history |
| Tab close | Server sees disconnect → "X left" |
| Nickname persistence | Stored in `sessionStorage` to pre-fill after refresh |

## 6. Validation Rules

| Field | Rule | Error text |
|---|---|---|
| Nickname | `^[A-Za-z0-9_]{2,20}$` | "Use 2–20 letters, numbers or underscores." |
| Nickname uniqueness | Case-insensitive among online users | "That nickname is already in use." |
| Message | 1–500 chars after trim | "Message must be 1–500 characters." |
| Rate limit | > 5 msgs / 3 s | "You're sending messages too fast." |

Validation runs on **both** client (fast feedback) and server (source of truth).

## 7. Accessibility

- Message list: `role="log"` with `aria-live="polite"`
- Inputs have `<label>` (visually hidden where needed)
- Colour contrast ≥ 4.5 : 1 for body text
- Visible focus ring on all interactive elements
- Connection status text also conveyed in words, not colour alone

## 8. Frontend Code Design

### 8.1 State (plain JS object)

```js
const state = {
  username: null,
  connected: false,
  users: [],
  typing: new Set(),
};
```

### 8.2 Function map (`app.js`)

| Function | Purpose |
|---|---|
| `initSocket()` | Create `io()` connection, register all listeners |
| `joinChat(name)` | Validate, emit `join`, handle ack |
| `sendMessage()` | Validate, emit `message` |
| `renderMessage(msg)` | Build bubble using `textContent` |
| `renderSystem(text)` | Centered notice |
| `renderUsers(list)` | Update online panel and count |
| `setStatus(kind)` | Update status dot/label, toggle composer |
| `handleTyping()` | Debounced typing emit |
| `scrollIfNearBottom()` | Smart auto-scroll |
| `formatTime(iso)` | Local `HH:MM` |

### 8.3 Security rule for rendering

Never use `innerHTML` with user data. Always:

```js
const p = document.createElement('p');
p.textContent = msg.content;
```

## 9. Backend Design Details

### 9.1 Socket handler flow

```
on "join"(payload, ack):
    name = validateNickname(payload.username)
    if invalid        → ack({ok:false, error})
    if name in online → ack({ok:false, error:"taken"})
    online.set(socket.id, name)
    socket.emit("join:ok", {history, users})
    io.emit("users", users); socket.broadcast.emit("system", "<name> joined")
    ack({ok:true})

on "message"(payload, ack):
    if !online.has(socket.id)  → ack({ok:false, error:"not joined"})
    if rateLimited(socket)     → emit "error:msg"
    content = validateMessage(payload.content)
    row = db.saveMessage(name, content)
    io.emit("message", row)

on "disconnect":
    name = online.get(socket.id); online.delete(socket.id)
    io.emit("users", ...); io.emit("system", "<name> left")
```

### 9.2 Error handling

- All handlers wrapped in try/catch; failures return `{ok:false, error}` and are logged.
- Unhandled rejections/exceptions logged; process exits so systemd restarts it cleanly.
- Graceful shutdown on `SIGTERM`: close Socket.IO, close DB.

## 10. Test Design

| Level | What | How |
|---|---|---|
| Unit | `validators.js`, `rateLimiter.js` | Node test runner / Jest |
| Integration | join → message → broadcast; duplicate nickname; history on join | `socket.io-client` scripted test |
| Manual (network) | Ping, `curl /health`, browser from Client VM | Checklist in `phases.md` |
| Manual (cloud) | Access via EC2 IP from host + phone | Checklist in `phases.md` |
| Security | `<script>alert(1)</script>` as message | Must render as plain text |
