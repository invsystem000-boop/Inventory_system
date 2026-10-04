const assert = require('assert');
const { hashPassword, verifyPassword, stripSensitiveFields, normalizeVerifiedStatus } = require('../auth-utils');

(async () => {
  const plain = 'Admin123!';
  const hashed = await hashPassword(plain);

  assert.notStrictEqual(hashed, plain, 'hashed password should not match plaintext');
  assert.strictEqual(await verifyPassword(plain, hashed), true, 'plaintext should verify against the hash');
  assert.strictEqual(await verifyPassword('wrongpass', hashed), false, 'wrong password should fail');

  const user = {
    _id: 'abc',
    username: 'admin',
    password: 'Admin123!',
    role: 'admin',
    name: 'Administrator',
    verified: true
  };

  const cleaned = stripSensitiveFields(user);
  assert.strictEqual(cleaned.password, undefined, 'password should be removed from API payloads');
  assert.strictEqual(cleaned.username, 'admin', 'non-sensitive fields should remain');
  assert.strictEqual(normalizeVerifiedStatus('true'), true, 'string true should map to boolean true');
  assert.strictEqual(normalizeVerifiedStatus('false'), false, 'string false should map to boolean false');

  console.log('security tests passed');
})();
