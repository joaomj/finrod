#!/usr/bin/env bash
# Permanent Matrix server for Finrod on the mini PC, as user joao.
# PostgreSQL (for MAS), Matrix Authentication Service, and Synapse run as Podman Quadlet user units on 127.0.0.1.
# Tailscale Serve publishes Synapse on :8448 and MAS on :8449. Federation off.
# Rerunnable: existing secrets, configs, and accounts are kept.
set -euo pipefail
SERVER=${MATRIX_SERVER_NAME:?Set MATRIX_SERVER_NAME to the Matrix server name, such as example.org.}
HOST=${MATRIX_HOST:?Set MATRIX_HOST to the Tailscale Serve name of this machine, such as host.tailnet.ts.net.}
PEOPLE=${MATRIX_USERS:?Set MATRIX_USERS to the Matrix user names of the people, separated by spaces, such as "alice bob".}
DIR=$HOME/matrix
SYNAPSE=docker.io/matrixdotorg/synapse:v1.164.2
MAS=ghcr.io/element-hq/matrix-authentication-service:1.28.0
PG=docker.io/library/postgres:17.11
UNITS=$HOME/.config/containers/systemd
umask 077
mkdir -p $DIR/synapse $DIR/mas $DIR/pg $UNITS
cd $DIR

[ -f secrets.env ] || { echo "PG_PASS=$(openssl rand -hex 16)"; echo "MAS_SECRET=$(openssl rand -hex 32)"; } > secrets.env
. ./secrets.env

MAS_USER=--userns=keep-id:uid=65532,gid=65532
if [ ! -s mas/config.yaml ]; then
  podman run --rm $MAS config generate > mas/base.yaml
  cat > mas/override.yaml <<EOF
http:
  public_base: https://$HOST:8449/
  issuer: https://$HOST:8449/
  listeners:
    - name: web
      resources: [{name: discovery}, {name: human}, {name: oauth}, {name: compat}, {name: graphql}, {name: assets}]
      binds: [{address: "127.0.0.1:8090"}]
database:
  uri: postgresql://mas:$PG_PASS@127.0.0.1:5433/mas
matrix:
  kind: synapse
  homeserver: $SERVER
  endpoint: http://127.0.0.1:8008/
  secret: $MAS_SECRET
passwords:
  enabled: true
account:
  password_registration_enabled: false
EOF
  podman run --rm $MAS_USER -v $DIR/mas:/m:Z $MAS config dump -c /m/base.yaml -c /m/override.yaml > mas/config.yaml
  rm mas/base.yaml mas/override.yaml
fi
grep -q "issuer: https://$HOST:8449/" mas/config.yaml || { echo "MAS issuer is not the public address" >&2; exit 1; }

if ! podman unshare grep -q matrix_authentication_service synapse/homeserver.yaml 2>/dev/null; then
  podman unshare test -f synapse/homeserver.yaml ||
    podman run --rm -v $DIR/synapse:/data:Z -e SYNAPSE_SERVER_NAME=$SERVER -e SYNAPSE_REPORT_STATS=no $SYNAPSE generate
  podman unshare sed -i "/^      - federation$/d; s/^  - port: 8008$/  - port: 8008\n    bind_addresses: ['127.0.0.1']/" synapse/homeserver.yaml
  podman unshare tee -a synapse/homeserver.yaml >/dev/null <<EOF
public_baseurl: https://$HOST:8448/
federation_domain_whitelist: []
matrix_authentication_service:
  enabled: true
  endpoint: http://127.0.0.1:8090/
  secret: "$MAS_SECRET"
EOF
fi

cat > $UNITS/matrix-pg.container <<EOF
[Unit]
Description=PostgreSQL for Matrix Authentication Service
[Container]
ContainerName=matrix-pg
Image=$PG
Network=host
Environment=PGPORT=5433 POSTGRES_USER=mas POSTGRES_DB=mas POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256
EnvironmentFile=$DIR/pg.env
Volume=$DIR/pg:/var/lib/postgresql/data:Z
Exec=-c listen_addresses=127.0.0.1
[Service]
Restart=on-failure
[Install]
WantedBy=default.target
EOF
echo "POSTGRES_PASSWORD=$PG_PASS" > pg.env

cat > $UNITS/matrix-mas.container <<EOF
[Unit]
Description=Matrix Authentication Service
Requires=matrix-pg.service
After=matrix-pg.service
[Container]
ContainerName=matrix-mas
Image=$MAS
UserNS=keep-id:uid=65532,gid=65532
Network=host
Volume=$DIR/mas:/m:Z
Exec=server -c /m/config.yaml
[Service]
Restart=on-failure
RestartSec=5
[Install]
WantedBy=default.target
EOF

cat > $UNITS/matrix-synapse.container <<EOF
[Unit]
Description=Synapse Matrix homeserver
Wants=matrix-mas.service
After=matrix-mas.service
[Container]
ContainerName=matrix-synapse
Image=$SYNAPSE
Network=host
Volume=$DIR/synapse:/data:Z
[Service]
Restart=on-failure
RestartSec=5
[Install]
WantedBy=default.target
EOF

podman unshare grep -q "bind_addresses: \['127.0.0.1'\]" synapse/homeserver.yaml || { echo "Synapse is not bound to 127.0.0.1" >&2; exit 1; }
podman unshare grep -q "^      - federation$" synapse/homeserver.yaml && { echo "Synapse still serves federation" >&2; exit 1; }

systemctl --user daemon-reload
systemctl --user start matrix-pg matrix-mas matrix-synapse

tailscale serve --bg --https=8448 http://127.0.0.1:8008 >/dev/null
for p in login logout refresh; do
  tailscale serve --bg --https=8448 --set-path /_matrix/client/v3/$p http://127.0.0.1:8090/_matrix/client/v3/$p >/dev/null
done
tailscale serve --bg --https=8449 http://127.0.0.1:8090 >/dev/null

for i in $(seq 60); do curl -sf http://127.0.0.1:8008/_matrix/client/versions >/dev/null && break; sleep 2; done
curl -sf http://127.0.0.1:8008/_matrix/client/versions >/dev/null && echo synapse-up
curl -sf http://127.0.0.1:8090/.well-known/openid-configuration >/dev/null && echo mas-up
ss -ltnH | awk '{print $4}' | grep -E ':(8008|8090|5433)$' | sort -u

# Accounts. A first password is written to accounts/<name> (mode 0600); people change theirs in the MAS account page.
mkdir -p accounts
for user in $PEOPLE finrod; do
  [ -f accounts/$user ] && continue
  pass=$(openssl rand -base64 18)
  podman exec matrix-mas mas-cli manage register-user -c /m/config.yaml --yes -p "$pass" $user 2>&1 | grep -E "registered|ERROR"
  echo "$pass" > accounts/$user
done
