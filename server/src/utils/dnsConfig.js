const dns = require('node:dns');

/**
 * Ensures Node.js has valid external DNS resolvers configured.
 * On Windows, Node.js (c-ares) can default to 127.0.0.1 which fails
 * SRV record queries for MongoDB Atlas (querySrv ECONNREFUSED).
 */
function configureDns() {
    try {
        if (process.env.DNS_SERVERS) {
            const servers = process.env.DNS_SERVERS.split(',').map((s) => s.trim()).filter(Boolean);
            if (servers.length > 0) {
                dns.setServers(servers);
                return;
            }
        }

        const currentServers = dns.getServers();
        const isLoopbackOnly =
            !currentServers ||
            currentServers.length === 0 ||
            currentServers.every((s) => s === '127.0.0.1' || s === '::1');

        if (isLoopbackOnly) {
            dns.setServers(['8.8.8.8', '1.1.1.1']);
        }
    } catch (err) {
        console.warn('⚠️ [DNS] Failed to set fallback DNS servers:', err.message);
    }
}

// Automatically configure DNS when imported
configureDns();

module.exports = { configureDns };
