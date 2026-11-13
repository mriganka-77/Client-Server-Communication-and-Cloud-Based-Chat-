const { test, describe } = require('node:test');
const assert = require('node:assert');
const { validateNickname, isNicknameAvailable, validateMessage } = require('../validators');
const RateLimiter = require('../rateLimiter');

describe('Validators Unit Tests', () => {
  test('validateNickname allows valid nicknames', () => {
    assert.strictEqual(validateNickname('alice').valid, true);
    assert.strictEqual(validateNickname('bob_123').valid, true);
    assert.strictEqual(validateNickname('user_name').sanitized, 'user_name');
  });

  test('validateNickname rejects invalid nicknames', () => {
    assert.strictEqual(validateNickname('').valid, false);
    assert.strictEqual(validateNickname('a').valid, false); // < 2 chars
    assert.strictEqual(validateNickname('a'.repeat(21)).valid, false); // > 20 chars
    assert.strictEqual(validateNickname('alice space').valid, false); // space
    assert.strictEqual(validateNickname('alice<script>').valid, false); // special chars
    assert.strictEqual(validateNickname(123).valid, false); // not string
  });

  test('isNicknameAvailable checks case-insensitive uniqueness', () => {
    const online = new Map([
      ['socket1', 'Alice'],
      ['socket2', 'Bob'],
    ]);

    assert.strictEqual(isNicknameAvailable('Charlie', online), true);
    assert.strictEqual(isNicknameAvailable('alice', online), false);
    assert.strictEqual(isNicknameAvailable('ALICE', online), false);
    assert.strictEqual(isNicknameAvailable('bob', online), false);
  });

  test('validateMessage allows valid messages and trims', () => {
    const res = validateMessage('  Hello world!  ');
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.sanitized, 'Hello world!');
  });

  test('validateMessage rejects empty or overly long messages', () => {
    assert.strictEqual(validateMessage('   ').valid, false);
    assert.strictEqual(validateMessage('').valid, false);
    assert.strictEqual(validateMessage('a'.repeat(501)).valid, false);
    assert.strictEqual(validateMessage(null).valid, false);
  });
});

describe('RateLimiter Unit Tests', () => {
  test('allows up to maxMessages within window, rejects subsequent calls', () => {
    const limiter = new RateLimiter({ maxMessages: 3, windowMs: 1000 });
    const socketId = 'sock-test-1';

    assert.strictEqual(limiter.check(socketId), true);
    assert.strictEqual(limiter.check(socketId), true);
    assert.strictEqual(limiter.check(socketId), true);
    // 4th call should be blocked
    assert.strictEqual(limiter.check(socketId), false);

    limiter.destroy();
  });
});
