const DEFAULT_PORTS = [3000, 3001, 3002, 5000, 5001, 5002];

function parsePortList(str) {
  if (!str && str !== 0) return [];
  return String(str)
    .split(',')
    .map(s => Number(s.trim()))
    .filter(n => Number.isInteger(n) && n > 0);
}

function getPortCandidates(explicitPort) {
  // explicitPort may be a single value or a comma-separated list
  const explicitList = [];
  if (explicitPort !== undefined && explicitPort !== null && String(explicitPort).trim() !== '') {
    if (String(explicitPort).includes(',')) {
      explicitList.push(...parsePortList(explicitPort));
    } else {
      const n = Number(explicitPort);
      if (Number.isInteger(n) && n > 0) explicitList.push(n);
    }
  }

  // Environment override: check PORTS or FALLBACK_PORTS (comma-separated)
  const envPorts = parsePortList(process.env.PORTS || process.env.FALLBACK_PORTS);

  const ports = [];
  for (const p of explicitList) if (!ports.includes(p)) ports.push(p);
  for (const p of envPorts) if (!ports.includes(p)) ports.push(p);
  for (const p of DEFAULT_PORTS) if (!ports.includes(p)) ports.push(p);

  return ports;
}

module.exports = {
  DEFAULT_PORTS,
  getPortCandidates,
};
