const logger = require('./logger');

/**
 * Multi homeserver support.
 *
 * Upstream UVS answers for exactly one homeserver: `UVS_HOMESERVER_URL` plus
 * `UVS_ACCESS_TOKEN` for the Synapse admin API. That is enough for OpenID
 * token verification, which happens against the user's own homeserver over
 * federation, but not for room membership and power levels -- only the
 * homeserver owning the room can answer those, and it needs its own admin
 * credential. The README states the limitation outright ("Room membership is
 * still currently limited to be verified from a single configured homeserver").
 *
 * `UVS_HOMESERVERS` supplies that mapping as JSON, keyed by Matrix server name,
 * which is the value clients pass as `matrix_server_name`:
 *
 *     {
 *       "example.org": {"url": "http://synapse:8008", "token": "syt_..."},
 *       "example.com": {"url": "https://matrix.example.com", "token": "syt_..."}
 *     }
 *
 * While it is unset every lookup falls back to the single homeserver variables,
 * so existing deployments are unaffected.
 */

// Keyed on the raw env string so a changed environment re-parses, which also
// keeps the parse (and its log output) out of the per request path.
let cache = {raw: null, parsed: null};

/**
 * Parsed and validated contents of `UVS_HOMESERVERS`.
 *
 * @returns {object|null}    Map of server name to {url, token}, or null when
 *                           multi homeserver mode is not configured at all.
 */
function getConfiguredHomeservers() {
    const raw = process.env.UVS_HOMESERVERS;
    if (!raw) {
        return null;
    }
    if (cache.raw === raw) {
        return cache.parsed;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        // Fail closed. Falling back to the single homeserver variables here
        // would silently answer for a server name the operator meant to scope.
        logger.log('error', `Failed to parse UVS_HOMESERVERS as JSON, refusing all requests: ${error}`);
        cache = {raw, parsed: {}};
        return cache.parsed;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        logger.log('error', 'UVS_HOMESERVERS must be a JSON object keyed by Matrix server name, refusing all requests.');
        cache = {raw, parsed: {}};
        return cache.parsed;
    }
    const homeservers = {};
    for (const [serverName, config] of Object.entries(parsed)) {
        if (
            !config || typeof config !== 'object' ||
            typeof config.url !== 'string' || config.url.length === 0 ||
            typeof config.token !== 'string' || config.token.length === 0
        ) {
            // Dropped rather than half accepted: an entry without a token would
            // turn every admin API call for that server into an unauthenticated
            // one, which reads as "user is not in the room" instead of an error.
            logger.log('error',
                `UVS_HOMESERVERS entry for ${serverName} needs a non-empty url and token, ignoring it.`);
            continue;
        }
        homeservers[serverName] = {url: config.url, token: config.token};
    }
    cache = {raw, parsed: homeservers};
    return homeservers;
}

/**
 * @returns {boolean}    Whether `UVS_HOMESERVERS` is configured.
 */
function isMultiHomeserverMode() {
    return getConfiguredHomeservers() !== null;
}

/**
 * Matrix server names whose OpenID tokens may be verified.
 *
 * @returns {string[]|null}    Allowed server names, or null when any server
 *                             name is accepted (the upstream default).
 */
function getAllowedServerNames() {
    const homeservers = getConfiguredHomeservers();
    if (homeservers) {
        return Object.keys(homeservers);
    }
    if (process.env.UVS_OPENID_VERIFY_SERVER_NAME) {
        return [process.env.UVS_OPENID_VERIFY_SERVER_NAME];
    }
    return null;
}

/**
 * Whether `matrix_server_name` has to be present in the request body.
 *
 * In multi homeserver mode it selects which homeserver to ask, so it is
 * mandatory. For a single homeserver the upstream rule is kept: required only
 * when no server name is pinned.
 *
 * @returns {boolean}
 */
function requiresServerName() {
    return isMultiHomeserverMode() || !process.env.UVS_OPENID_VERIFY_SERVER_NAME;
}

/**
 * Synapse admin API to ask about rooms owned by the given server name.
 *
 * @param {string} serverName    Matrix server name from the request
 * @returns {object|null}        {url, token}, or null if no homeserver is
 *                               configured for that server name.
 */
function resolveAdminHomeserver(serverName) {
    const homeservers = getConfiguredHomeservers();
    if (!homeservers) {
        const url = process.env.UVS_HOMESERVER_URL;
        if (!url) {
            return null;
        }
        return {url, token: process.env.UVS_ACCESS_TOKEN};
    }
    return homeservers[serverName] || null;
}

module.exports = {
    getAllowedServerNames,
    isMultiHomeserverMode,
    requiresServerName,
    resolveAdminHomeserver,
};
