/**
 * LANChat Client Application
 * Authenticated & End-to-End Encrypted (E2EE) Messenger
 */

// Application State
const state = {
  token: null,
  currentUser: null,
  ownPrivateKey: null,
  activeRoom: null,
  users: [],
  rooms: [],
  onlineUserIds: new Set(),
  cachedSharedKeys: new Map(), // peerUserId -> CryptoKey
  cachedGroupKeys: new Map(),  // roomId -> CryptoKey
};

let socket = null;
let typingTimeout = null;
let isTyping = false;

// DOM Elements
const authScreen = document.getElementById('auth-screen');
const chatScreen = document.getElementById('chat-screen');
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const authForm = document.getElementById('auth-form');
const authUsername = document.getElementById('auth-username');
const authPassword = document.getElementById('auth-password');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const authError = document.getElementById('auth-error');

const currentUsernameDisplay = document.getElementById('current-username');
const logoutBtn = document.getElementById('logout-btn');
const directUsersList = document.getElementById('direct-users-list');
const groupsList = document.getElementById('groups-list');

const activeChatTitle = document.getElementById('active-chat-title');
const activeChatParticipants = document.getElementById('active-chat-participants');
const connectionStatus = document.getElementById('connection-status');
const connectionStatusText = document.getElementById('connection-status-text');

const messagesContainer = document.getElementById('messages-container');
const typingIndicator = document.getElementById('typing-indicator');
const composerForm = document.getElementById('composer-form');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const toast = document.getElementById('toast');

// Modal Elements
const groupModal = document.getElementById('group-modal');
const openGroupModalBtn = document.getElementById('open-group-modal-btn');
const closeModalBtn = document.getElementById('close-modal-btn');
const cancelGroupBtn = document.getElementById('cancel-group-btn');
const createGroupForm = document.getElementById('create-group-form');
const groupNameInput = document.getElementById('group-name-input');
const groupMembersSelection = document.getElementById('group-members-selection');

let authMode = 'login'; // 'login' or 'register'

/**
 * Toast notifications
 */
function showToast(msg, duration = 3500) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, duration);
}

/**
 * Time formatting
 */
function formatTime(isoString) {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  } catch {
    return '';
  }
}

/**
 * Switch Auth Tab
 */
function setAuthMode(mode) {
  authMode = mode;
  authError.textContent = '';
  if (mode === 'login') {
    tabLogin.classList.add('active');
    tabLogin.setAttribute('aria-selected', 'true');
    tabRegister.classList.remove('active');
    tabRegister.setAttribute('aria-selected', 'false');
    authSubmitBtn.textContent = 'Sign In';
  } else {
    tabRegister.classList.add('active');
    tabRegister.setAttribute('aria-selected', 'true');
    tabLogin.classList.remove('active');
    tabLogin.setAttribute('aria-selected', 'false');
    authSubmitBtn.textContent = 'Create Account (Generate E2EE Keys)';
  }
}

tabLogin.addEventListener('click', () => setAuthMode('login'));
tabRegister.addEventListener('click', () => setAuthMode('register'));

/**
 * Auth Form Submit (Login or Register)
 */
authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.textContent = '';
  authSubmitBtn.disabled = true;

  const username = authUsername.value.trim();
  const password = authPassword.value;

  try {
    let publicKeyPayload = null;

    if (authMode === 'register') {
      authSubmitBtn.textContent = 'Generating Cryptographic Keys…';
      const keyPair = await E2EE.generateIdentityKeyPair();
      const pubJwk = await E2EE.exportKey(keyPair.publicKey);
      const privJwk = await E2EE.exportKey(keyPair.privateKey);

      E2EE.saveStoredKeys(username, privJwk, pubJwk);
      publicKeyPayload = pubJwk;

      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, publicKey: publicKeyPayload }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');

      handleAuthSuccess(data.token, data.user, privJwk);
    } else {
      // Login mode
      authSubmitBtn.textContent = 'Authenticating…';
      let stored = E2EE.getStoredKeys(username);
      let privJwk = stored ? stored.privateKeyJwk : null;

      // If user logs in on a browser without keys, generate a new pair and update public key on server
      if (!privJwk) {
        const keyPair = await E2EE.generateIdentityKeyPair();
        const pubJwk = await E2EE.exportKey(keyPair.publicKey);
        privJwk = await E2EE.exportKey(keyPair.privateKey);
        E2EE.saveStoredKeys(username, privJwk, pubJwk);
        publicKeyPayload = pubJwk;
      }

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, publicKey: publicKeyPayload }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');

      handleAuthSuccess(data.token, data.user, privJwk);
    }
  } catch (err) {
    authError.textContent = err.message;
  } finally {
    authSubmitBtn.disabled = false;
    authSubmitBtn.textContent = authMode === 'login' ? 'Sign In' : 'Create Account';
  }
});

/**
 * Handle successful authentication
 */
async function handleAuthSuccess(token, user, privJwk) {
  state.token = token;
  state.currentUser = user;
  sessionStorage.setItem('lanchat_token', token);

  // Import user's private key into Web Crypto CryptoKey object
  state.ownPrivateKey = await E2EE.importPrivateKey(privJwk);

  currentUsernameDisplay.textContent = user.username;

  // Switch to Chat Screen
  authScreen.classList.add('hidden');
  authScreen.setAttribute('aria-hidden', 'true');
  chatScreen.classList.remove('hidden');
  chatScreen.setAttribute('aria-hidden', 'false');

  initSocket();
  await loadConversationsAndUsers();
}

/**
 * Logout
 */
logoutBtn.addEventListener('click', async () => {
  try {
    if (state.token) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${state.token}` },
      });
    }
  } catch (_) {}

  sessionStorage.removeItem('lanchat_token');
  state.token = null;
  state.currentUser = null;
  state.ownPrivateKey = null;
  state.activeRoom = null;
  state.cachedSharedKeys.clear();
  state.cachedGroupKeys.clear();

  if (socket) socket.disconnect();

  chatScreen.classList.add('hidden');
  authScreen.classList.remove('hidden');
  authPassword.value = '';
});

/**
 * Load User List and Rooms
 */
async function loadConversationsAndUsers() {
  if (!state.token) return;

  try {
    const [usersRes, roomsRes] = await Promise.all([
      fetch('/api/users', { headers: { Authorization: `Bearer ${state.token}` } }),
      fetch('/api/rooms', { headers: { Authorization: `Bearer ${state.token}` } }),
    ]);

    if (usersRes.ok) state.users = await usersRes.json();
    if (roomsRes.ok) state.rooms = await roomsRes.json();

    renderDirectUsersList();
    renderGroupsList();
  } catch (err) {
    console.error('Error loading conversations:', err);
  }
}

/**
 * Render Direct Users (1-on-1 chats)
 */
function renderDirectUsersList() {
  directUsersList.innerHTML = '';

  if (state.users.length === 0) {
    const li = document.createElement('li');
    li.style.padding = '8px 12px';
    li.style.color = 'var(--muted)';
    li.style.fontSize = '12px';
    li.textContent = 'No other registered users yet.';
    directUsersList.appendChild(li);
    return;
  }

  state.users.forEach((u) => {
    const isOnline = state.onlineUserIds.has(u.id);
    const li = document.createElement('li');
    li.className = 'conversation-item';
    if (state.activeRoom && state.activeRoom.type === 'direct' && state.activeRoom.peerUser && state.activeRoom.peerUser.id === u.id) {
      li.classList.add('active');
    }

    const info = document.createElement('div');
    info.className = 'conversation-info';

    const dot = document.createElement('span');
    dot.className = `conversation-status-dot ${isOnline ? 'online' : 'offline'}`;

    const title = document.createElement('span');
    title.className = 'conversation-title';
    title.textContent = u.username;

    info.appendChild(dot);
    info.appendChild(title);

    const lockIcon = document.createElement('span');
    lockIcon.textContent = '🔒';
    lockIcon.style.fontSize = '12px';
    lockIcon.title = 'E2EE Pairwise Encrypted';

    li.appendChild(info);
    li.appendChild(lockIcon);

    li.addEventListener('click', () => openDirectChat(u));
    directUsersList.appendChild(li);
  });
}

/**
 * Render Groups List
 */
function renderGroupsList() {
  groupsList.innerHTML = '';
  const groupRooms = state.rooms.filter((r) => r.type === 'group');

  if (groupRooms.length === 0) {
    const li = document.createElement('li');
    li.style.padding = '8px 12px';
    li.style.color = 'var(--muted)';
    li.style.fontSize = '12px';
    li.textContent = 'No group chats yet. Click "+ New Group" above!';
    groupsList.appendChild(li);
    return;
  }

  groupRooms.forEach((r) => {
    const li = document.createElement('li');
    li.className = 'conversation-item';
    if (state.activeRoom && state.activeRoom.id === r.id) {
      li.classList.add('active');
    }

    const info = document.createElement('div');
    info.className = 'conversation-info';

    const icon = document.createElement('span');
    icon.textContent = '👥';

    const title = document.createElement('span');
    title.className = 'conversation-title';
    title.textContent = r.name;

    info.appendChild(icon);
    info.appendChild(title);

    const memberCount = document.createElement('span');
    memberCount.style.fontSize = '11px';
    memberCount.style.color = 'var(--muted)';
    memberCount.textContent = `${r.members ? r.members.length : ''} 🔒`;

    li.appendChild(info);
    li.appendChild(memberCount);

    li.addEventListener('click', () => openGroupChat(r));
    groupsList.appendChild(li);
  });
}

/**
 * Get or Derive Pairwise Shared Key with a User (ECDH -> AES-GCM)
 */
async function getPairwiseKey(peerUser) {
  if (state.cachedSharedKeys.has(peerUser.id)) {
    return state.cachedSharedKeys.get(peerUser.id);
  }

  const peerPubKey = await E2EE.importPublicKey(peerUser.public_key);
  const sharedKey = await E2EE.derivePairwiseKey(state.ownPrivateKey, peerPubKey);
  state.cachedSharedKeys.set(peerUser.id, sharedKey);
  return sharedKey;
}

/**
 * Open Direct Chat (1-on-1)
 */
async function openDirectChat(peerUser) {
  try {
    const res = await fetch('/api/rooms/direct', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify({ targetUserId: peerUser.id }),
    });

    if (!res.ok) throw new Error('Could not open direct chat');
    const room = await res.json();
    room.peerUser = peerUser;

    state.activeRoom = room;

    // Join room channel via socket
    if (socket) socket.emit('room:join', { roomId: room.id });

    activeChatTitle.textContent = peerUser.username;
    activeChatParticipants.textContent = `Direct conversation between you and ${peerUser.username}`;

    renderDirectUsersList();
    renderGroupsList();

    messageInput.disabled = false;
    sendBtn.disabled = false;
    messageInput.focus();

    await loadRoomMessages(room.id);
  } catch (err) {
    showToast(err.message);
  }
}

/**
 * Open Group Chat
 */
async function openGroupChat(room) {
  state.activeRoom = room;

  if (socket) socket.emit('room:join', { roomId: room.id });

  activeChatTitle.textContent = room.name;
  const memberNames = room.members.map((m) => m.username).join(', ');
  activeChatParticipants.textContent = `${room.members.length} members: ${memberNames}`;

  renderDirectUsersList();
  renderGroupsList();

  messageInput.disabled = false;
  sendBtn.disabled = false;
  messageInput.focus();

  await loadRoomMessages(room.id);
}

/**
 * Get or Decrypt Group Encryption Key
 */
async function getGroupKey(room) {
  if (state.cachedGroupKeys.has(room.id)) {
    return state.cachedGroupKeys.get(room.id);
  }

  // Find creator's public key
  const creator = room.members.find((m) => m.id === room.created_by);
  if (!creator) throw new Error('Group creator key missing');

  // Derive pairwise key with group creator
  const creatorPairwiseKey = await getPairwiseKey(creator);

  // Decrypt user's encrypted_group_key
  const encryptedPayload = room.encrypted_group_key;
  if (!encryptedPayload) throw new Error('No encrypted group key present for this user.');

  const decryptedJwkString = await E2EE.decrypt(
    creatorPairwiseKey,
    encryptedPayload.ciphertext,
    encryptedPayload.iv
  );

  const groupKeyJwk = JSON.parse(decryptedJwkString);
  const groupKey = await E2EE.importAesKey(groupKeyJwk);

  state.cachedGroupKeys.set(room.id, groupKey);
  return groupKey;
}

/**
 * Load & Decrypt Messages for Active Room
 */
async function loadRoomMessages(roomId) {
  messagesContainer.innerHTML = '';

  try {
    const res = await fetch(`/api/rooms/${roomId}/messages`, {
      headers: { Authorization: `Bearer ${state.token}` },
    });

    if (!res.ok) throw new Error('Failed to load messages');
    const encryptedMessages = await res.json();

    if (encryptedMessages.length === 0) {
      messagesContainer.innerHTML = `
        <div class="empty-chat-placeholder">
          <span class="placeholder-icon">🔒</span>
          <p>This conversation is empty. All messages sent here are end-to-end encrypted.</p>
        </div>
      `;
      return;
    }

    for (const msg of encryptedMessages) {
      await renderEncryptedMessage(msg);
    }

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Decrypt & Render a message safely
 */
async function renderEncryptedMessage(msg) {
  const isOwn = msg.sender_id === state.currentUser.id;
  let plaintext = '[Decrypting…]';

  try {
    if (state.activeRoom.type === 'direct') {
      const peerUser = state.activeRoom.peerUser;
      const pairwiseKey = await getPairwiseKey(peerUser);
      plaintext = await E2EE.decrypt(pairwiseKey, msg.ciphertext, msg.iv);
    } else {
      const groupKey = await getGroupKey(state.activeRoom);
      plaintext = await E2EE.decrypt(groupKey, msg.ciphertext, msg.iv);
    }
  } catch (err) {
    plaintext = '[⚠️ Decryption failed]';
  }

  const row = document.createElement('div');
  row.className = `message-row ${isOwn ? 'own' : 'other'}`;

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.textContent = `${isOwn ? 'You' : msg.sender_username} • ${formatTime(msg.created_at)} 🔒`;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = plaintext; // Strictly textContent (prevents XSS)

  row.appendChild(meta);
  row.appendChild(bubble);
  messagesContainer.appendChild(row);
}

/**
 * Send Encrypted Message
 */
composerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.activeRoom) return;

  const content = messageInput.value.trim();
  if (!content) return;

  sendBtn.disabled = true;

  try {
    let encryptedPayload;

    if (state.activeRoom.type === 'direct') {
      const pairwiseKey = await getPairwiseKey(state.activeRoom.peerUser);
      encryptedPayload = await E2EE.encrypt(pairwiseKey, content);
    } else {
      const groupKey = await getGroupKey(state.activeRoom);
      encryptedPayload = await E2EE.encrypt(groupKey, content);
    }

    socket.emit(
      'chat:message',
      {
        roomId: state.activeRoom.id,
        ciphertext: encryptedPayload.ciphertext,
        iv: encryptedPayload.iv,
      },
      (ack) => {
        sendBtn.disabled = false;
        if (ack && !ack.ok) {
          showToast(ack.error || 'Failed to deliver message');
        } else {
          messageInput.value = '';
          messageInput.focus();
        }
      }
    );
  } catch (err) {
    showToast(`Encryption failed: ${err.message}`);
    sendBtn.disabled = false;
  }
});

/**
 * Socket.IO Initialization
 */
function initSocket() {
  if (socket) socket.disconnect();

  socket = io({
    auth: { token: state.token },
    reconnection: true,
  });

  socket.on('connect', () => {
    connectionStatus.className = 'status-indicator status-connected';
    connectionStatusText.textContent = 'Connected';
  });

  socket.on('disconnect', () => {
    connectionStatus.className = 'status-indicator status-disconnected';
    connectionStatusText.textContent = 'Disconnected';
  });

  socket.on('presence', (onlineIds) => {
    state.onlineUserIds = new Set(onlineIds);
    renderDirectUsersList();
  });

  // Incoming encrypted message
  socket.on('chat:message', async (savedMsg) => {
    if (state.activeRoom && state.activeRoom.id === savedMsg.room_id) {
      // Remove placeholder if present
      const placeholder = messagesContainer.querySelector('.empty-chat-placeholder');
      if (placeholder) placeholder.remove();

      await renderEncryptedMessage(savedMsg);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  });

  // Real-time group creation notification
  socket.on('room:created', async (room) => {
    state.rooms.unshift(room);
    renderGroupsList();
    showToast(`New encrypted group "${room.name}" created!`);
  });

  socket.on('error:msg', ({ message }) => {
    showToast(message);
  });
}

/**
 * Group Creation Modal Logic
 */
openGroupModalBtn.addEventListener('click', () => {
  groupNameInput.value = '';
  groupMembersSelection.innerHTML = '';

  state.users.forEach((u) => {
    const label = document.createElement('label');
    label.className = 'member-checkbox-label';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = u.id;
    checkbox.dataset.username = u.username;

    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(` ${u.username} (🔒 E2EE verified)`));
    groupMembersSelection.appendChild(label);
  });

  groupModal.classList.remove('hidden');
  groupModal.setAttribute('aria-hidden', 'false');
  groupNameInput.focus();
});

function closeGroupModal() {
  groupModal.classList.add('hidden');
  groupModal.setAttribute('aria-hidden', 'true');
}

closeModalBtn.addEventListener('click', closeGroupModal);
cancelGroupBtn.addEventListener('click', closeGroupModal);

/**
 * Create Encrypted Group Form Submit
 */
createGroupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const groupName = groupNameInput.value.trim();
  if (!groupName) return;

  const checkedBoxes = groupMembersSelection.querySelectorAll('input[type="checkbox"]:checked');
  if (checkedBoxes.length === 0) {
    showToast('Please select at least one member to join the group.');
    return;
  }

  const selectedMemberIds = Array.from(checkedBoxes).map((cb) => Number(cb.value));
  selectedMemberIds.push(state.currentUser.id); // Add self

  try {
    // 1. Generate fresh AES-256-GCM symmetric group key
    const groupKey = await E2EE.generateGroupKey();
    const groupKeyJwk = await E2EE.exportKey(groupKey);
    const rawGroupKeyJson = JSON.stringify(groupKeyJwk);

    // 2. Encrypt the group key for every participant using pairwise ECDH shared keys
    const memberKeysMap = {};

    for (const memberId of selectedMemberIds) {
      let pairwiseKey;
      if (memberId === state.currentUser.id) {
        // Creator's own pairwise key (ECDH with self's public key)
        pairwiseKey = await E2EE.derivePairwiseKey(
          state.ownPrivateKey,
          await E2EE.importPublicKey(state.currentUser.public_key)
        );
      } else {
        const peer = state.users.find((u) => u.id === memberId);
        pairwiseKey = await getPairwiseKey(peer);
      }

      // Encrypt the group key
      const encryptedKey = await E2EE.encrypt(pairwiseKey, rawGroupKeyJson);
      memberKeysMap[memberId] = encryptedKey;
    }

    // 3. Send encrypted group setup to server
    const res = await fetch('/api/rooms/group', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify({
        name: groupName,
        memberKeysMap,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create group');

    closeGroupModal();
    state.rooms.unshift(data);
    renderGroupsList();
    openGroupChat(data);
    showToast(`Encrypted group "${groupName}" created!`);
  } catch (err) {
    showToast(`Group creation failed: ${err.message}`);
  }
});

/**
 * Mobile Sidebar Toggle
 */
const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
const chatSidebar = document.querySelector('.chat-sidebar');
sidebarToggleBtn.addEventListener('click', () => {
  chatSidebar.classList.toggle('open');
});

/**
 * Check existing session on load
 */
window.addEventListener('DOMContentLoaded', async () => {
  const savedToken = sessionStorage.getItem('lanchat_token');
  if (savedToken) {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${savedToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        const stored = E2EE.getStoredKeys(data.user.username);
        if (stored) {
          handleAuthSuccess(savedToken, data.user, stored.privateKeyJwk);
          return;
        }
      }
    } catch (_) {}
  }

  // Default to Auth Screen
  authScreen.classList.remove('hidden');
  chatScreen.classList.add('hidden');
});
