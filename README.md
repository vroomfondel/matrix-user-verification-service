# Matrix User Verification Service

Service to verify details of a user based on an Open ID Connect token.

Main features:

* Verifies a C2S [Open ID token](https://matrix.org/docs/spec/client_server/r0.6.1#id154)
  using the S2S [UserInfo endpoint](https://matrix.org/docs/spec/server_server/r0.1.4#openid).
* Can verify user is a member in a given room (Synapse only currently, requires admin level token).
  In addition to returning membership status, returned will be user power level, the room power 
  defaults and required power for events.

## How to use

### Dependencies

```
npm install
```

### Configuration

Copy the default `.env.default` to `.env` and modify as needed.

```
## REQUIRED
# Homeserver client API admin token (synapse only)
# Required for the service to verify room membership
UVS_ACCESS_TOKEN=foobar
# Homeserver client API URL
UVS_HOMESERVER_URL=https://matrix.org
# Disable check for non private IP range of homeserver. E.g. set to `true` if your homeserver domain resolves to a private IP.
UVS_DISABLE_IP_BLACKLIST=true

## OPTIONAL
# Auth token to protect the API
# If this is set any calls to the provided API endpoints
# need have the header "Authorization: Bearer changeme".
UVS_AUTH_TOKEN=changeme
# Matrix server name to verify OpenID tokens against. See below section.
# Defaults to empty value which means verification is made against
# whatever Matrix server name passed in with the token.
UVS_OPENID_VERIFY_SERVER_NAME=matrix.org
# Serve several homeservers at once. JSON object keyed by Matrix server name,
# each with the admin API URL and an admin token for that homeserver. Replaces
# UVS_HOMESERVER_URL, UVS_ACCESS_TOKEN and UVS_OPENID_VERIFY_SERVER_NAME when
# set. See below section.
UVS_HOMESERVERS={"example.org":{"url":"http://synapse:8008","token":"syt_..."}}
# Listen address of the bot
UVS_LISTEN_ADDRESS=127.0.0.1
# Listen port of the bot
UVS_PORT=3000
# Log level, defaults to 'info'
# See choices here: https://github.com/winstonjs/winston#logging-levels
UVS_LOG_LEVEL=info
```

#### OpenID token verification

UVS can run in a single homeserver mode or be configured to trust any
homeserver OpenID token. Default is to trust the any Matrix server name
that is given with the OpenID token.

To disable this and ensure only OpenID tokens from a single Matrix homeserver
will be trusted, set the homeserver Matrix server name in the variable
`UVS_OPENID_VERIFY_SERVER_NAME`. Note, this is the server name of the homeserver,
not the client or federation API's domain.

In either mode, the [UserInfo endpoint](https://matrix.org/docs/spec/server_server/r0.1.4#openid)
is determined by [resolving server names in the usual way](https://matrix.org/docs/spec/server_server/latest#resolving-server-names)
so a `/.well-known/matrix/server` file may be needed even if the homeserver
isn't otherwise federating. If the homeserver config doesn't have the `federation`
listener setup, the `openid` listener can be added on the same port as the `client`
listener.

#### Multiple homeservers

Room membership and power levels can only be answered by the homeserver that
owns the room, using its Synapse admin API — so serving users of more than one
homeserver needs one admin credential per homeserver. `UVS_HOMESERVERS` holds
them, keyed by Matrix server name, which is the value clients pass as
`matrix_server_name`:

```json
{
  "example.org": {"url": "http://synapse:8008", "token": "syt_..."},
  "example.com": {"url": "https://matrix.example.com", "token": "syt_..."}
}
```

When set, it replaces `UVS_HOMESERVER_URL`, `UVS_ACCESS_TOKEN` and
`UVS_OPENID_VERIFY_SERVER_NAME`: OpenID tokens are accepted for exactly the
server names listed, each room lookup goes to the matching homeserver with its
own token, and `matrix_server_name` becomes a required request field. An
unknown server name is refused rather than falling back to a default
homeserver, and a malformed `UVS_HOMESERVERS` refuses everything instead of
quietly reverting to single homeserver mode.

While unset, behaviour is unchanged: one homeserver via `UVS_HOMESERVER_URL`.

Note that federation is not required between the homeservers, but each one
must still expose the federation `openid` endpoint for token verification, as
described above.

### API's available

### Authentication

If `UVS_AUTH_TOKEN` is set, you'll need to provide an authorization header as follows:

    Authorization: Bearer <value of UVS_AUTH_TOKEN>

#### Verify OpenID token

Verifies a user OpenID token.

    POST /verify/user
    Content-Type: application/json

Request body:

```json
{
  "matrix_server_name": "domain.tld",
  "token": "secret OpenID token provided by the user"
}
```

Successful validation response:

```json
{
  "results": {
    "user": true
  },
  "user_id": "@user:domain.tld"
}
```

Failed validation:

```json
{
  "results": {
    "user": false
  },
  "user_id": null
}
```

#### Verify OpenID token and room membership

Verifies a user OpenID token and membership in a room.

    POST /verify/user_in_room
    Content-Type: application/json

Request body:

```json
{
  "matrix_server_name": "domain.tld",
  "room_id": "!foobar:domain.tld",
  "token": "secret OpenID token provided by the user"
}
```

Successful validation response:

```json
{
  "results": {
    "room_membership": true,
    "user": true
  },
  "user_id": "@user:domain.tld",
  "power_levels": {
    "room": {
      "ban": 50,
      "events": {
        "m.room.avatar": 50,
        "m.room.canonical_alias": 50,
        "m.room.history_visibility": 100,
        "m.room.name": 50,
        "m.room.power_levels": 100
      },
      "events_default": 0,
      "invite": 0,
      "kick": 50,
      "redact": 50,
      "state_default": 50,
      "users_default": 0
    },
    "user": 50
  }
}
```

Failed validation, in case token is not valid:

```json
{
  "results": {
    "room_membership": false,
    "user": false
  },
  "user_id": null,
  "power_levels": null
}
```

In the token was validated but user is not in room, the failed response is:

```json
{
  "results": {
    "room_membership": false,
    "user": true
  },
  "user_id": "@user:domain.tld",
  "power_levels": null
}
```

### Running

```
npm start
```

### Development

Run in watch mode.

```
npm run dev
```

## License

Apache 2.0
