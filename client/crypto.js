/**
 * LANChat E2EE Cryptographic Module
 * Built using the standard native Web Crypto API (window.crypto.subtle).
 * 
 * Cryptography used:
 * - Identity & Key Exchange: ECDH (Elliptic Curve Diffie-Hellman) over NIST P-256 curve
 * - Symmetric Encryption: AES-GCM 256-bit with unique 12-byte IV per message
 * - Zero external libraries required.
 */

const E2EE = {
  // Utility: ArrayBuffer to Base64
  buf2b64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  },

  // Utility: Base64 to Uint8Array
  b642buf(base64) {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  },

  /**
   * Generates a persistent ECDH P-256 key pair for the user's identity.
   */
  async generateIdentityKeyPair() {
    return window.crypto.subtle.generateKey(
      {
        name: 'ECDH',
        namedCurve: 'P-256',
      },
      true,
      ['deriveKey', 'deriveBits']
    );
  },

  /**
   * Export CryptoKey as JWK (JSON Web Key) object
   */
  async exportKey(key) {
    return window.crypto.subtle.exportKey('jwk', key);
  },

  /**
   * Import public JWK key
   */
  async importPublicKey(jwk) {
    const keyData = typeof jwk === 'string' ? JSON.parse(jwk) : jwk;
    return window.crypto.subtle.importKey(
      'jwk',
      keyData,
      {
        name: 'ECDH',
        namedCurve: 'P-256',
      },
      true,
      []
    );
  },

  /**
   * Import private JWK key
   */
  async importPrivateKey(jwk) {
    const keyData = typeof jwk === 'string' ? JSON.parse(jwk) : jwk;
    return window.crypto.subtle.importKey(
      'jwk',
      keyData,
      {
        name: 'ECDH',
        namedCurve: 'P-256',
      },
      true,
      ['deriveKey', 'deriveBits']
    );
  },

  /**
   * Derives an AES-GCM 256-bit symmetric key between this user's private key and peer's public key
   */
  async derivePairwiseKey(ownPrivateKey, peerPublicKey) {
    return window.crypto.subtle.deriveKey(
      {
        name: 'ECDH',
        public: peerPublicKey,
      },
      ownPrivateKey,
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['encrypt', 'decrypt']
    );
  },

  /**
   * Generates a fresh AES-256-GCM symmetric key for a group
   */
  async generateGroupKey() {
    return window.crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['encrypt', 'decrypt']
    );
  },

  /**
   * Imports an AES-GCM raw JWK key
   */
  async importAesKey(jwk) {
    const keyData = typeof jwk === 'string' ? JSON.parse(jwk) : jwk;
    return window.crypto.subtle.importKey(
      'jwk',
      keyData,
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['encrypt', 'decrypt']
    );
  },

  /**
   * Encrypts plaintext string using AES-GCM with fresh 12-byte IV
   * Returns { ciphertext: base64, iv: base64 }
   */
  async encrypt(key, plaintext) {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);

    const ciphertextBuffer = await window.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      encoded
    );

    return {
      ciphertext: this.buf2b64(ciphertextBuffer),
      iv: this.buf2b64(iv),
    };
  },

  /**
   * Decrypts ciphertext Base64 using AES-GCM and IV Base64
   * Returns plaintext string
   */
  async decrypt(key, ciphertextB64, ivB64) {
    try {
      const ciphertext = this.b642buf(ciphertextB64);
      const iv = this.b642buf(ivB64);

      const decryptedBuffer = await window.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv,
        },
        key,
        ciphertext
      );

      return new TextDecoder().decode(decryptedBuffer);
    } catch (err) {
      console.warn('Decryption failed with key:', err);
      return '[⚠️ Unable to decrypt message - key mismatch or corrupted payload]';
    }
  },

  /**
   * Key Storage helpers in browser localStorage
   */
  getStoredKeys(username) {
    const priv = localStorage.getItem(`e2ee_priv_${username.toLowerCase()}`);
    const pub = localStorage.getItem(`e2ee_pub_${username.toLowerCase()}`);
    if (priv && pub) {
      return { privateKeyJwk: JSON.parse(priv), publicKeyJwk: JSON.parse(pub) };
    }
    return null;
  },

  saveStoredKeys(username, privateKeyJwk, publicKeyJwk) {
    localStorage.setItem(`e2ee_priv_${username.toLowerCase()}`, JSON.stringify(privateKeyJwk));
    localStorage.setItem(`e2ee_pub_${username.toLowerCase()}`, JSON.stringify(publicKeyJwk));
  },
};

