const chai = require('chai');
const homeservers = require('../src/homeservers');
const mockedEnv = require('mocked-env');

require('../src/logger');

const expect = chai.expect;

const TWO_SERVERS = JSON.stringify({
    'example.org': {url: 'http://synapse.local:8008', token: 'token-org'},
    'example.com': {url: 'https://matrix.example.com', token: 'token-com'},
});

describe('homeservers', function() {
    let restoreEnv;

    afterEach(() => {
        if (restoreEnv) {
            restoreEnv();
            restoreEnv = null;
        }
    });

    describe('single homeserver mode', function() {
        it('falls back to the single homeserver variables', function() {
            restoreEnv = mockedEnv({
                UVS_HOMESERVER_URL: 'http://synapse.local',
                UVS_ACCESS_TOKEN: 'legacy-token',
                UVS_HOMESERVERS: undefined,
            });
            expect(homeservers.isMultiHomeserverMode()).to.be.false;
            expect(homeservers.resolveAdminHomeserver('whatever.example')).to.eql({
                url: 'http://synapse.local',
                token: 'legacy-token',
            });
        });

        it('allows any server name when none is pinned', function() {
            restoreEnv = mockedEnv({
                UVS_OPENID_VERIFY_SERVER_NAME: undefined,
                UVS_HOMESERVERS: undefined,
            });
            expect(homeservers.getAllowedServerNames()).to.be.null;
            expect(homeservers.requiresServerName()).to.be.true;
        });

        it('allows only the pinned server name', function() {
            restoreEnv = mockedEnv({
                UVS_OPENID_VERIFY_SERVER_NAME: 'example.org',
                UVS_HOMESERVERS: undefined,
            });
            expect(homeservers.getAllowedServerNames()).to.eql(['example.org']);
            // Upstream behaviour: with a pin the field stays optional.
            expect(homeservers.requiresServerName()).to.be.false;
        });
    });

    describe('multi homeserver mode', function() {
        beforeEach(() => {
            restoreEnv = mockedEnv({
                UVS_HOMESERVERS: TWO_SERVERS,
                UVS_HOMESERVER_URL: 'http://ignored.local',
                UVS_ACCESS_TOKEN: 'ignored-token',
            });
        });

        it('allows every configured server name', function() {
            expect(homeservers.isMultiHomeserverMode()).to.be.true;
            expect(homeservers.getAllowedServerNames()).to.have.members(['example.org', 'example.com']);
        });

        it('resolves each server to its own admin credentials', function() {
            expect(homeservers.resolveAdminHomeserver('example.org')).to.eql({
                url: 'http://synapse.local:8008',
                token: 'token-org',
            });
            expect(homeservers.resolveAdminHomeserver('example.com')).to.eql({
                url: 'https://matrix.example.com',
                token: 'token-com',
            });
        });

        it('does not fall back for an unknown server name', function() {
            expect(homeservers.resolveAdminHomeserver('evil.example')).to.be.null;
        });

        it('requires the server name in the request', function() {
            expect(homeservers.requiresServerName()).to.be.true;
        });
    });

    describe('invalid configuration', function() {
        it('fails closed on malformed JSON', function() {
            restoreEnv = mockedEnv({
                UVS_HOMESERVERS: '{not json',
                UVS_HOMESERVER_URL: 'http://synapse.local',
                UVS_ACCESS_TOKEN: 'legacy-token',
            });
            // Notably does NOT fall back to the single homeserver variables.
            expect(homeservers.getAllowedServerNames()).to.eql([]);
            expect(homeservers.resolveAdminHomeserver('example.org')).to.be.null;
        });

        it('fails closed when not a JSON object', function() {
            restoreEnv = mockedEnv({UVS_HOMESERVERS: '["example.org"]'});
            expect(homeservers.getAllowedServerNames()).to.eql([]);
        });

        it('drops entries missing a url or token', function() {
            restoreEnv = mockedEnv({
                UVS_HOMESERVERS: JSON.stringify({
                    'good.example': {url: 'http://synapse.local', token: 'token'},
                    'no-token.example': {url: 'http://synapse.local'},
                    'no-url.example': {token: 'token'},
                    'empty.example': {url: '', token: ''},
                }),
            });
            expect(homeservers.getAllowedServerNames()).to.eql(['good.example']);
            expect(homeservers.resolveAdminHomeserver('no-token.example')).to.be.null;
        });
    });
});
