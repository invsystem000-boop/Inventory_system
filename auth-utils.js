const bcrypt = require('bcryptjs');

const PASSWORD_SALT_ROUNDS = 12;

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

module.exports = {
  hashPassword,
  verifyPassword,
  stripSensitiveFields,
  normalizeVerifiedStatus
};
