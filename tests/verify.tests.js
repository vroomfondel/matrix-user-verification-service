const chai = require('chai');
const matrixUtils = require('../src/matrixUtils');
const mockedEnv = require('mocked-env');
const sinon = require('sinon');
const utils = require('../src/utils');
const verify = require('../src/verify');

require('../src/logger');

const expect = chai.expect;

describe('verify', function() {
    let axiosStub;
    let matrixUtilsStub;
    let originalEnv;

    before(() => {
        originalEnv = mockedEnv({
            UVS_HOMESERVER_URL: 'http://synapse.local',
        });
    });

    beforeEach(() => {
        matrixUtilsStub = sinon.stub(matrixUtils, 'discoverHomeserverUrl');
        matrixUtilsStub.onFirstCall().returns({
            homeserverUrl: 'https://synapse.local',
            serverName: 'synapse.local',
        });
    });

    after(() => {
        originalEnv();
    });

    afterEach(function() {
        try {
            axiosStub.restore();
        // eslint-disable-next-line no-empty
        } catch (error) {}
        try {
            matrixUtilsStub.restore();
        // eslint-disable-next-line no-empty
        } catch (error) {}
    });

    describe('verifyOpenIDToken', function() {
        it('calls configured homeserver with token', async () => {
            axiosStub = sinon.stub(utils, 'axiosGet').returns({data: {'sub': '@user:domain.tld'}});
            matrixUtilsStub.onFirstCall().returns({
                homeserverUrl: 'https://domain.tld',
                serverName: 'domain.tld',
            });

            let req = {
                body: {
                    matrix_server_name: 'domain.tld',
                    token: 'token',
                },
            };
            const response = await verify.verifyOpenIDToken(req);

            expect(response).to.equal('@user:domain.tld');
            expect(axiosStub.calledOnce).to.be.true;
            expect(axiosStub.firstCall.args[0]).to.include(
                'https://domain.tld/_matrix/federation/v1/openid/userinfo?access_token=token',
            );
        });

        it('returns false if openid token subject does not match given matrix server name', async () => {
            axiosStub = sinon.stub(utils, 'axiosGet').returns({data: {'sub': '@user:domain.tld'}});

            let req = {
                body: {
                    matrix_server_name: 'synapse.local',
                    token: 'token',
                },
            };
            const response = await verify.verifyOpenIDToken(req);

            expect(response).to.be.false;
            expect(axiosStub.calledOnce).to.be.true;
            expect(axiosStub.firstCall.args[0]).to.include(
                'https://synapse.local/_matrix/federation/v1/openid/userinfo?access_token=token',
            );
        });

        describe('single homeserver mode', () => {
            let originalEnv;

            before(() => {
                originalEnv = mockedEnv({
                    UVS_OPENID_VERIFY_SERVER_NAME: 'matrix.org',
                });
            });

            after(() => {
                originalEnv();
            });

            it('does not call any other homeserver', async function() {
                axiosStub = sinon.stub(utils, 'axiosGet');
                let req = {
                    body: {
                        matrix_server_name: 'synapse.local',
                        token: 'foobar',
                    },
                };
                const response = await verify.verifyOpenIDToken(req);
                expect(response).to.be.false;
                expect(axiosStub.calledOnce).to.be.false;
            });
        });

        describe('multi homeserver mode', () => {
            let originalEnv;

            before(() => {
                originalEnv = mockedEnv({
                    UVS_OPENID_VERIFY_SERVER_NAME: undefined,
                    UVS_HOMESERVERS: JSON.stringify({
                        'synapse.local': {url: 'http://synapse.local:8008', token: 'token-local'},
                        'other.example': {url: 'http://other.example:8008', token: 'token-other'},
                    }),
                });
            });

            after(() => {
                originalEnv();
            });

            it('accepts a token for any configured server name', async function() {
                axiosStub = sinon.stub(utils, 'axiosGet').returns({data: {'sub': '@user:synapse.local'}});
                let req = {
                    body: {
                        matrix_server_name: 'synapse.local',
                        token: 'foobar',
                    },
                };
                const response = await verify.verifyOpenIDToken(req);
                expect(response).to.equal('@user:synapse.local');
            });

            it('refuses a server name that is not configured', async function() {
                axiosStub = sinon.stub(utils, 'axiosGet');
                let req = {
                    body: {
                        matrix_server_name: 'evil.example',
                        token: 'foobar',
                    },
                };
                const response = await verify.verifyOpenIDToken(req);
                expect(response).to.be.false;
                expect(axiosStub.called).to.be.false;
            });
        });
    });

    describe('verifyRoomMembership', function() {
        let originalEnv;

        before(() => {
            originalEnv = mockedEnv({
                // Deliberately set, to prove they are no longer consulted.
                UVS_HOMESERVER_URL: 'http://single.local',
                UVS_ACCESS_TOKEN: 'single-token',
                UVS_HOMESERVERS: JSON.stringify({
                    'synapse.local': {url: 'http://synapse.local:8008', token: 'token-local'},
                    'other.example': {url: 'http://other.example:8008', token: 'token-other'},
                }),
            });
        });

        after(() => {
            originalEnv();
        });

        it('asks the homeserver owning the room, with that homeserver token', async function() {
            axiosStub = sinon.stub(utils, 'axiosGet').returns({data: {members: ['@user:other.example']}});
            let req = {
                body: {
                    matrix_server_name: 'other.example',
                    room_id: '!room:other.example',
                },
            };
            const response = await verify.verifyRoomMembership('@user:other.example', req);
            expect(response).to.be.true;
            expect(axiosStub.firstCall.args[0]).to.include('http://other.example:8008');
            expect(axiosStub.firstCall.args[2]).to.eql({Authorization: 'Bearer token-other'});
        });

        it('fails closed for a server name with no admin credentials', async function() {
            axiosStub = sinon.stub(utils, 'axiosGet');
            let req = {
                body: {
                    matrix_server_name: 'unknown.example',
                    room_id: '!room:unknown.example',
                },
            };
            const response = await verify.verifyRoomMembership('@user:unknown.example', req);
            expect(response).to.be.false;
            expect(axiosStub.called).to.be.false;
        });
    });
});
