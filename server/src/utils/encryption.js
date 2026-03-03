const crypto = require('crypto');

// Ensure key is exactly 32 bytes (256 bits) for aes-256-cbc.
// It can be provided as a 64-character hex string in the environment.
const rawKey = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
let KEY;
try {
  KEY = Buffer.from(rawKey, 'hex');
  if (KEY.length !== 32) {
    throw new Error('Invalid key length');
  }
} catch (e) {
  // Fallback to a hash of the raw string to ensure exactly 32 bytes
  KEY = crypto.createHash('sha256').update(rawKey).digest();
}

const IV_LENGTH = 16;
const ALGO = 'aes-256-cbc';

/**
 * Encrypts a string using AES-256-CBC.
 */
function encrypt(text) {
  if (!text) return text;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts a string that was encrypted by `encrypt()`.
 */
function decrypt(encrypted) {
  if (!encrypted) return encrypted;
  const parts = encrypted.split(':');
  if (parts.length !== 2) throw new Error('Invalid encrypted format');
  
  const [ivHex, encryptedText] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Creates a deterministic, standard SHA-256 hash of a string.
 * We use this to generate a predictable but opaque `connectionId`
 * from the user's connection string.
 */
function hashString(text) {
  if (!text) return text;
  return crypto.createHash('sha256').update(text).digest('hex');
}

module.exports = {
  encrypt,
  decrypt,
  hashString
};
