const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const PASSWORD_SALT_ROUNDS = 12;

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(String(value || ''), 'base64url').toString('utf8');
}

async function hashPassword(password) {
  if (typeof password !== 'string' || password.trim() === '') {
    throw new Error('Password is required');
  }
  return bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
}

async function verifyPassword(password, hash) {
  if (typeof password !== 'string' || typeof hash !== 'string' || !hash) {
    return false;
  }
  return bcrypt.compare(password, hash);
}

function stripSensitiveFields(user) {
  if (!user || typeof user !== 'object') return user;
  const { password, ...safeUser } = user;
  return safeUser;
}

function normalizeVerifiedStatus(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'verified'].includes(normalized)) return true;
    if (['false', '0', 'no', 'unverified'].includes(normalized)) return false;
  }
  return Boolean(value);
}

function createSessionToken(payload, secret) {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'session' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifySessionToken(token, secret) {
  if (typeof token !== 'string' || !token) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [header, body, signature] = parts;
  const expectedSignature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');

  try {
    if (signature.length !== expectedSignature.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return null;
    }

    const parsedBody = JSON.parse(base64UrlDecode(body));
    if (!parsedBody || typeof parsedBody !== 'object') {
      return null;
    }

    if (parsedBody.exp && Number(parsedBody.exp) < Date.now()) {
      return null;
    }

    return parsedBody;
  } catch (err) {
    return null;
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  stripSensitiveFields,
  normalizeVerifiedStatus,
  createSessionToken,
  verifySessionToken
};
