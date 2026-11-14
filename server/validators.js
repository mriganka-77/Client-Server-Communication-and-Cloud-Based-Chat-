const NICKNAME_REGEX = /^[A-Za-z0-9_]{2,20}$/;

/**
 * Validates a nickname.
 * Returns { valid: boolean, error?: string, sanitized?: string }
 */
function validateNickname(rawName) {
  if (typeof rawName !== 'string') {
    return { valid: false, error: 'Nickname must be a string.' };
  }

  const trimmed = rawName.trim();
  if (trimmed.length < 2 || trimmed.length > 20) {
    return { valid: false, error: 'Use 2–20 letters, numbers or underscores.' };
  }

  if (!NICKNAME_REGEX.test(trimmed)) {
    return { valid: false, error: 'Use 2–20 letters, numbers or underscores.' };
  }

  return { valid: true, sanitized: trimmed };
}

/**
 * Checks if a nickname is unique among online users (case-insensitive).
 * onlineUsers: Map<string, string> (socketId -> username) or Array of strings
 */
function isNicknameAvailable(nickname, onlineUsers) {
  const target = nickname.toLowerCase();
  const usernames = onlineUsers instanceof Map ? onlineUsers.values() : onlineUsers;
  for (const name of usernames) {
    if (name.toLowerCase() === target) {
      return false;
    }
  }
  return true;
}

/**
 * Validates a message content.
 * Returns { valid: boolean, error?: string, sanitized?: string }
 */
function validateMessage(rawContent) {
  if (typeof rawContent !== 'string') {
    return { valid: false, error: 'Message must be text.' };
  }

  const trimmed = rawContent.trim();
  if (trimmed.length < 1 || trimmed.length > 500) {
    return { valid: false, error: 'Message must be 1–500 characters.' };
  }

  return { valid: true, sanitized: trimmed };
}

module.exports = {
  validateNickname,
  isNicknameAvailable,
  validateMessage,
};

