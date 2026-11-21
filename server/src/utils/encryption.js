const crypto = require('crypto');

// The key MUST be a 64-character hexadecimal string (32 bytes) in process.env.ENCRYPTION_KEY.
const HEX_64_REGEX = /^[0-9a-fA-F]{64}$/;
const rawKey = process.env.ENCRYPTION_KEY;

if (!rawKey || typeof rawKey !== 'string' || !HEX_64_REGEX.test(rawKey)) {
    throw new Error('ENCRYPTION_KEY environment variable is required and must be a 64-character hexadecimal string');
}

const KEY = Buffer.from(rawKey, 'hex');

// Current format: "v2:<iv hex>:<auth tag hex>:<ciphertext hex>" (AES-256-GCM).
const GCM_ALGO = 'aes-256-gcm';
const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;
const V2_PREFIX = 'v2:';

// Legacy format: "<iv hex>:<ciphertext hex>" (AES-256-CBC). Decrypt only; /connect
// re-encrypts on every upsert, so stored values move to v2 as users reconnect.
const LEGACY_ALGO = 'aes-256-cbc';

const HEX_RE = /^(?:[0-9a-f]{2})*$/i;

/**
 * Encrypts a string with AES-256-GCM (authenticated).
 */
function encrypt(text) {
  if (!text) return text;
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv(GCM_ALGO, KEY, iv, { authTagLength: GCM_TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${V2_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

function decryptV2(payload) {
  const parts = payload.split(':');
  if (parts.length !== 3 || !parts.every((p) => HEX_RE.test(p))) throw new Error('Invalid encrypted format');
  const [ivHex, tagHex, ctHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  if (iv.length !== GCM_IV_LENGTH || tag.length !== GCM_TAG_LENGTH) throw new Error('Invalid encrypted format');

  const decipher = crypto.createDecipheriv(GCM_ALGO, KEY, iv, { authTagLength: GCM_TAG_LENGTH });
  decipher.setAuthTag(tag);
  // final() throws if the ciphertext or tag was modified.
  return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]).toString('utf8');
}

function decryptLegacyCbc(encrypted) {
  const parts = encrypted.split(':');
  if (parts.length !== 2) throw new Error('Invalid encrypted format');
  const [ivHex, encryptedText] = parts;
  const decipher = crypto.createDecipheriv(LEGACY_ALGO, KEY, Buffer.from(ivHex, 'hex'));
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Decrypts a value written by `encrypt()` (v2, GCM) or by the earlier CBC version.
 */
function decrypt(encrypted) {
  if (!encrypted) return encrypted;
  if (encrypted.startsWith(V2_PREFIX)) return decryptV2(encrypted.slice(V2_PREFIX.length));
  return decryptLegacyCbc(encrypted);
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

/**
 * The `connectionId` for a stored connection: a hash of the connection string
 * AND the database name, so the same cluster connected with two different
 * databases gives two independent sessions (F15). The NUL separator cannot
 * appear in a URI or a MongoDB database name, so no two pairs collide.
 *
 * @param {string} connectionString
 * @param {string} dbName
 * @returns {string} 64 hex chars
 */
function connectionIdFor(connectionString, dbName) {
  if (!connectionString || !dbName) throw new Error('connectionIdFor needs a connection string and a dbName');
  return hashString(`${connectionString}\u0000${dbName}`);
}

module.exports = {
  encrypt,
  decrypt,
  hashString,
  connectionIdFor
};
