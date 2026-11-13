/**
 * LANChat Client Application
 * Vanilla JS, event-driven, zero build tools.
 */

// Application State
const state = {
  username: null,
  connected: false,
  joined: false,
  users: [],
  typingUsers: new Set(),
};

let socket = null;
let typingTimeout = null;
let isUserTyping = false;

// DOM Elements
const joinScreen = document.getElementById('join-screen');
const chatScreen = document.getElementById('chat-screen');
const joinForm = document.getElementById('join-form');
const nicknameInput = document.getElementById('nickname-input');
const joinBtn = document.getElementById('join-btn');
const joinError = document.getElementById('join-error');

const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const onlineCounter = document.getElementById('online-counter');
const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
const onlineSidebar = document.getElementById('online-sidebar');
const onlineUsersList = document.getElementById('online-users-list');

const messagesContainer = document.getElementById('messages-container');
const scrollBottomPill = document.getElementById('scroll-bottom-pill');
const typingIndicator = document.getElementById('typing-indicator');
const composerForm = document.getElementById('composer-form');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const toast = document.getElementById('toast');

/**
 * Display toast error notification
 */
function showToast(message, duration = 3500) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, duration);
}

/**
 * Format ISO timestamp to local HH:MM
 */
function formatTime(isoString) {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  } catch {
    return '';
  }
}

/**
 * Check if the messages container is scrolled near bottom
 */
function isNearBottom(threshold = 120) {
  return messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight <= threshold;
}

/**
 * Scroll to bottom of message list
 */
function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  scrollBottomPill.classList.add('hidden');
}

/**
 * Updates connection status badge and composer availability
 */
function setStatus(kind, label) {
  statusIndicator.className = 'status-indicator';
  if (kind === 'connected') {
    statusIndicator.classList.add('status-connected');
    statusText.textContent = label || 'Connected';
    composerForm.querySelectorAll('input, button').forEach(el => el.disabled = false);
  } else if (kind === 'reconnecting') {
    statusIndicator.classList.add('status-connecting');
    statusText.textContent = label || 'Reconnecting…';
    composerForm.querySelectorAll('input, button').forEach(el => el.disabled = true);
  } else {
    statusIndicator.classList.add('status-disconnected');
    statusText.textContent = label || 'Disconnected';
    composerForm.querySelectorAll('input, button').forEach(el => el.disabled = true);
  }
}

/**
 * Build and render a message bubble safely using textContent (No innerHTML)
 */
function renderMessage(msg) {
  const isScrolled = isNearBottom();
  const isOwn = state.username && msg.username.toLowerCase() === state.username.toLowerCase();

  const row = document.createElement('div');
  row.className = `message-row ${isOwn ? 'own' : 'other'}`;

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  const nameSpan = document.createElement('span');
  nameSpan.className = 'message-author';
  nameSpan.textContent = isOwn ? 'You' : msg.username;

  const timeSpan = document.createElement('span');
  timeSpan.className = 'message-time';
  timeSpan.textContent = ` • ${formatTime(msg.createdAt)}`;

  meta.appendChild(nameSpan);
  meta.appendChild(timeSpan);

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = msg.content; // Strictly textContent to avoid XSS

  row.appendChild(meta);
  row.appendChild(bubble);
  messagesContainer.appendChild(row);

  if (isScrolled || isOwn) {
    scrollToBottom();
  } else {
    scrollBottomPill.classList.remove('hidden');
  }
}

/**
 * Render system event (user join/leave)
 */
function renderSystem(text, createdAt) {
  const isScrolled = isNearBottom();

  const row = document.createElement('div');
  row.className = 'system-row';

  const badge = document.createElement('span');
  badge.className = 'system-text';
  const time = createdAt ? ` (${formatTime(createdAt)})` : '';
  badge.textContent = `— ${text}${time} —`;

  row.appendChild(badge);
  messagesContainer.appendChild(row);

  if (isScrolled) {
    scrollToBottom();
  }
}

/**
 * Update online users roster and counter
 */
function renderUsers(userList) {
  state.users = userList || [];
  const count = state.users.length;
  onlineCounter.textContent = `${count} online`;

  onlineUsersList.innerHTML = '';
  state.users.forEach((user) => {
    const li = document.createElement('li');
    li.className = 'online-user-item';

    const dot = document.createElement('span');
    dot.className = 'user-status-dot';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = user;

    li.appendChild(dot);
    li.appendChild(nameSpan);

    if (state.username && user.toLowerCase() === state.username.toLowerCase()) {
      const youTag = document.createElement('span');
      youTag.className = 'user-you-tag';
      youTag.textContent = '(you)';
      li.appendChild(youTag);
    }

    onlineUsersList.appendChild(li);
  });
}

/**
 * Update typing indicator bar
 */
function updateTypingDisplay() {
  const usersTyping = Array.from(state.typingUsers).filter(
    (u) => !state.username || u.toLowerCase() !== state.username.toLowerCase()
  );

  if (usersTyping.length === 0) {
    typingIndicator.textContent = '';
    typingIndicator.classList.add('hidden');
  } else {
    typingIndicator.classList.remove('hidden');
    if (usersTyping.length === 1) {
      typingIndicator.textContent = `${usersTyping[0]} is typing…`;
    } else if (usersTyping.length === 2) {
      typingIndicator.textContent = `${usersTyping[0]} and ${usersTyping[1]} are typing…`;
    } else {
      typingIndicator.textContent = `Several people are typing…`;
    }
  }
}

/**
 * Initialize Socket.IO connection and handlers
 */
function initSocket() {
  if (typeof io === 'undefined') {
    setStatus('disconnected', 'Socket error');
    showToast('Failed to load real-time client library.');
    return;
  }

  socket = io({
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: Infinity,
  });

  socket.on('connect', () => {
    state.connected = true;
    setStatus('connected', 'Connected');

    // If already had a session before reconnecting, rejoin automatically
    if (state.joined && state.username) {
      socket.emit('join', { username: state.username }, (res) => {
        if (!res || !res.ok) {
          showToast(res ? res.error : 'Failed to re-establish session.');
        }
      });
    }
  });

  socket.on('disconnect', (reason) => {
    state.connected = false;
    setStatus('reconnecting', 'Reconnecting…');
  });

  socket.on('connect_error', () => {
    state.connected = false;
    setStatus('reconnecting', 'Reconnecting…');
  });

  // Received history and user list on join
  socket.on('join:ok', (data) => {
    state.joined = true;
    messagesContainer.innerHTML = '';

    if (Array.isArray(data.history)) {
      data.history.forEach((msg) => renderMessage(msg));
      scrollToBottom();
    }

    if (Array.isArray(data.users)) {
      renderUsers(data.users);
    }
  });

  // Incoming chat message
  socket.on('message', (msg) => {
    renderMessage(msg);
  });

  // System notification (join/leave)
  socket.on('system', (data) => {
    renderSystem(data.text, data.createdAt);
  });

  // Online roster update
  socket.on('users', (userList) => {
    renderUsers(userList);
  });

  // Typing updates
  socket.on('typing', ({ username, isTyping }) => {
    if (isTyping) {
      state.typingUsers.add(username);
    } else {
      state.typingUsers.delete(username);
    }
    updateTypingDisplay();
  });

  // Error messages from server (rate limits, validation)
  socket.on('error:msg', ({ message }) => {
    showToast(message);
  });
}

/**
 * Handle joining the chat
 */
function joinChat(nickname) {
  const trimmed = nickname.trim();
  joinError.textContent = '';

  if (!/^[A-Za-z0-9_]{2,20}$/.test(trimmed)) {
    joinError.textContent = 'Use 2–20 letters, numbers or underscores.';
    return;
  }

  joinBtn.disabled = true;

  if (!socket || !socket.connected) {
    joinError.textContent = 'Connecting to server, please wait…';
    joinBtn.disabled = false;
    return;
  }

  socket.emit('join', { username: trimmed }, (ack) => {
    joinBtn.disabled = false;

    if (!ack || !ack.ok) {
      joinError.textContent = ack ? ack.error : 'Could not join chat.';
      return;
    }

    state.username = trimmed;
    try {
      sessionStorage.setItem('lanchat_username', trimmed);
    } catch (_) {}

    // Switch screens
    joinScreen.classList.add('hidden');
    joinScreen.setAttribute('aria-hidden', 'true');
    chatScreen.classList.remove('hidden');
    chatScreen.setAttribute('aria-hidden', 'false');
    messageInput.focus();
  });
}

/**
 * Handle sending a message
 */
function sendMessage() {
  const content = messageInput.value.trim();
  if (!content) return;

  if (content.length > 500) {
    showToast('Message must be 1–500 characters.');
    return;
  }

  // Clear typing state
  if (isUserTyping) {
    isUserTyping = false;
    clearTimeout(typingTimeout);
    socket.emit('typing', { isTyping: false });
  }

  sendBtn.disabled = true;

  socket.emit('message', { content }, (ack) => {
    sendBtn.disabled = false;
    if (ack && !ack.ok) {
      showToast(ack.error || 'Failed to send message.');
    } else {
      messageInput.value = '';
      messageInput.focus();
    }
  });
}

/**
 * Handle typing input debounce
 */
function handleTyping() {
  if (!socket || !socket.connected || !state.joined) return;

  if (!isUserTyping) {
    isUserTyping = true;
    socket.emit('typing', { isTyping: true });
  }

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    isUserTyping = false;
    socket.emit('typing', { isTyping: false });
  }, 2000);
}

// Event Listeners
joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  joinChat(nicknameInput.value);
});

composerForm.addEventListener('submit', (e) => {
  e.preventDefault();
  sendMessage();
});

messageInput.addEventListener('input', handleTyping);

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

scrollBottomPill.addEventListener('click', () => {
  scrollToBottom();
});

messagesContainer.addEventListener('scroll', () => {
  if (isNearBottom()) {
    scrollBottomPill.classList.add('hidden');
  }
});

toggleSidebarBtn.addEventListener('click', () => {
  onlineSidebar.classList.toggle('open');
});

// Auto-restore nickname from sessionStorage if available
window.addEventListener('DOMContentLoaded', () => {
  try {
    const savedName = sessionStorage.getItem('lanchat_username');
    if (savedName) {
      nicknameInput.value = savedName;
    }
  } catch (_) {}

  initSocket();
});
