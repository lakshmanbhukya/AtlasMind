const jwt = require('jsonwebtoken');

const SECRET  = process.env.JWT_SECRET;
const EXPIRES = '7d';

if (!SECRET) {
    console.error('❌ JWT_SECRET is not set in .env — authentication will fail!');
}

/**
 * Sign a JWT containing the connectionId.
 * @param {string} connectionId
 * @returns {string} signed token
 */
function signToken(connectionId) {
    return jwt.sign({ connectionId }, SECRET, { expiresIn: EXPIRES });
}

/**
 * Verify a JWT and return its payload.
 * Throws if invalid or expired.
 * @param {string} token
 * @returns {{ connectionId: string, iat: number, exp: number }}
 */
function verifyToken(token) {
    return jwt.verify(token, SECRET);
}

module.exports = { signToken, verifyToken };
