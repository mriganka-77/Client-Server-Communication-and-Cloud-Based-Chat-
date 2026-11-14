/**
 * Token bucket / sliding window rate limiter per socket.
 * Max 5 messages per 3 seconds.
 */
class RateLimiter {
  constructor({ maxMessages = 5, windowMs = 3000 } = {}) {
    this.maxMessages = maxMessages;
    this.windowMs = windowMs;
    // Map: socketId -> Array of timestamps [t1, t2, ...]
    this.buckets = new Map();

    // Periodic sweep every 60 seconds to clean up inactive sockets
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [socketId, timestamps] of this.buckets.entries()) {
        const recent = timestamps.filter((t) => now - t < this.windowMs);
        if (recent.length === 0) {
          this.buckets.delete(socketId);
        } else {
          this.buckets.set(socketId, recent);
        }
      }
    }, 60000);

    // Prevent interval from keeping the process alive
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Checks whether the socket is allowed to send a message.
   * Returns true if allowed, false if rate limited.
   */
  check(socketId) {
    const now = Date.now();
    const timestamps = this.buckets.get(socketId) || [];
    
    // Filter to timestamps within the sliding window
    const validTimestamps = timestamps.filter((t) => now - t < this.windowMs);

    if (validTimestamps.length >= this.maxMessages) {
      this.buckets.set(socketId, validTimestamps);
      return false; // Rate limit exceeded
    }

    validTimestamps.push(now);
    this.buckets.set(socketId, validTimestamps);
    return true; // Allowed
  }

  /**
   * Removes socket from rate limiter on disconnect.
   */
  remove(socketId) {
    this.buckets.delete(socketId);
  }

  destroy() {
    clearInterval(this.cleanupInterval);
    this.buckets.clear();
  }
}

module.exports = RateLimiter;

