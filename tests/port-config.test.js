const assert = require('assert');
const { getPortCandidates } = require('../port-config');

const ports = getPortCandidates(3001);
assert.deepStrictEqual(ports[0], 3001, 'Explicit PORT should be tried first');
assert.deepStrictEqual(ports[1], 3000, 'Only default port 3000 should be included as fallback');

console.log('port-config tests passed');
