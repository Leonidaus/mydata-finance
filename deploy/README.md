# Deploying the demo

`main` is the persistent build. Every push to `main` runs `.github/workflows/deploy.yml`,
which publishes the Docker image to GitHub's container registry and, when a host is
configured, redeploys it there.

The demo is at **https://s-pankki-demo.duckdns.org/**. The previous
https://135.181.63.189.compute.verda.run/ address remains available as an alias.

## One-time host setup

Any Linux machine with a public address and Docker works (for example a small CPU
instance on Verda or Aiven).

1. Install Docker with the compose plugin, and open ports 80 and 443.
2. Create the directory and copy the Compose file and proxy configuration:
   ```bash
   mkdir -p /srv/mydata/data /srv/mydata/profiles
   chown 1000:1000 /srv/mydata/profiles
   scp deploy/docker-compose.yml deploy/Caddyfile <user>@<host>:/srv/mydata/
   ```
3. Copy the database. The full one is 663 MB; `build_database.py --keep-customers`
   makes a 2 MB one with only the demo customers (see the main README):
   ```bash
   scp data/out/finance.sqlite <user>@<host>:/srv/mydata/data/finance.sqlite
   ```
4. Create `/srv/mydata/.env` on the host:
   ```
   DOMAIN=demo.example.com        # a hostname whose DNS points to this server
   ```
   The service keys do not go here; the deploy workflow writes them (see below).
5. Let the host pull the image. Either make the package public (GitHub → the
   repository owner's Packages → mydata-finance → Package settings → Change
   visibility), or run `docker login ghcr.io` on the host with a token that can read
   packages.
6. Start it: `cd /srv/mydata && docker compose up -d`, then open `https://<DOMAIN>`.

## Custom domain and aliases

Point the hostname's DNS A record to the server's public IP before starting Caddy.
It obtains and renews HTTPS certificates automatically when the name resolves to
this server and ports 80 and 443 are reachable. No DuckDNS token is needed on the
server when the DNS record is maintained through the DuckDNS dashboard.

For the current demo, the public DNS record points to `135.181.63.189` and the
host's `/srv/mydata/.env` contains:

```dotenv
DOMAIN=s-pankki-demo.duckdns.org
DOMAIN_ALIASES=135.181.63.189.compute.verda.run
```

`DOMAIN_ALIASES` is optional. For several aliases, use a quoted, space-separated
list. A single `DOMAIN` without aliases continues to work. Both the web app and
`/api` use the hostname the visitor opened, so this change needs no app rebuild or
API base URL override. Browser-local dashboard and language settings remain scoped
to each hostname; both names use the same backend and stored coaching profiles.

After changing hostnames, validate and recreate only the proxy:

```bash
cd /srv/mydata
docker compose config --quiet
docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose up -d --no-deps caddy
```

Check the page and `/api/health` over HTTPS for the primary name and each alias.

## Automatic redeploys

The workflow reads these repository secrets (Settings → Secrets and variables →
Actions, or `gh secret set NAME`):

| Secret | Value | Status |
|---|---|---|
| `DEPLOY_SSH_KEY` | The private key the workflow logs in with | Set on 14 November. The private half exists only in GitHub. |
| `DEPLOY_HOST` | The host's address | To set once a host exists |
| `DEPLOY_USER` | The SSH user (defaults to `root`) | Optional |
| `ELEVENLABS_API_KEY` | Key for the voice routes | Set on 14 November |
| `GEMINI_API_KEY` | Key for the chat | To set |

The voice model settings are non-secret GitHub Actions variables. The deployment
uses `eleven_multilingual_v2` for reliable Finnish and monetary output, the selected
Finnish/English app locale is sent with each request, and `scribe_v3` is used for
transcription. Override
`ELEVENLABS_VOICE_ID`, `ELEVENLABS_TTS_MODEL_ID`, or `ELEVENLABS_STT_MODEL_ID`
as repository variables only when a different provider setting is needed.

On every deploy the workflow writes the service keys that are set to
`/srv/mydata/keys.env` on the host (readable only by the deploy user), and the app
container reads that file. A missing key just leaves that service off; `/api/health`
shows which are on. To change a key, update the secret and re-run the Deploy workflow.

When an ElevenLabs key is configured, the CI workflow synthesizes one short Finnish
sentence after trusted pushes to `develop` or `main`. This uses a small number of
ElevenLabs credits, but catches provider, model, voice, and output failures before a
release is prepared. Deployment itself remains limited to its health check.

The workflow refreshes both `docker-compose.yml` and `Caddyfile`. Hostnames stay in
the host's `.env`, so a new release retains the configured primary name and aliases.

The public half of the deploy key is in [`deploy_key.pub`](deploy_key.pub). Allow it on
the host, for the user the workflow logs in as:

```bash
ssh <user>@<host> 'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys' < deploy/deploy_key.pub
gh secret set DEPLOY_HOST --body "<host address>"
```

Without `DEPLOY_HOST` the workflow still publishes the image and skips the deploy. To
replace the key, generate a new pair, run `gh secret set DEPLOY_SSH_KEY < new_key`, and
update `deploy_key.pub` and the host's `authorized_keys`.

## Access logs and traffic

Caddy writes JSON access logs for the primary hostname and aliases to
`/data/access-logs/access.log` inside the proxy container. This is in the existing
`caddy_data` volume, so the logs survive container recreation and app releases.
Files are readable only by their owner, rotate at 10 MiB or after 24 hours, and
keep up to seven archives younger than seven days. Caddy redacts authorization
and cookie headers by default. Request bodies are not included.

After connecting to the host, follow requests with:

```bash
docker exec mydata-caddy-1 tail -f /data/access-logs/access.log
```

The log includes timestamps, request host/method/path, client addresses, user
agents, response status, size and duration. Timestamps are Unix seconds; convert
to `Europe/Helsinki` when reporting a Finnish calendar day. Archives in the same
directory are compressed after rotation.

Successful `GET /` requests approximate page opens. Count API paths separately;
static asset requests are not extra visits. Filter health checks, test traffic
and identifiable crawlers when reporting usage. Unique client addresses are an
estimate of visitors, not a count of people, especially on shared event Wi-Fi.
Logging only records requests received after it was enabled.

For a logging-only configuration change, validate and reload the running proxy:

```bash
docker exec mydata-caddy-1 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec mydata-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

The Caddyfile is mounted as a single file. Update its contents in place so the
container continues to see the same inode. Caddy requires a restart to change
options for an already-open log filename; ordinary reloads are sufficient when
first enabling logging or when changing unrelated proxy configuration.

## When the database must be rebuilt

The backend refuses to start if the database was built with different basket rules
than the code expects, and says so. Rebuild it with `data/prep/build_database.py` and
copy it to the host again. A code change that does not touch the rules or the database
layout needs no new database.

## Rolling back

Every image is also tagged with its commit. To go back:

```bash
cd /srv/mydata && IMAGE=ghcr.io/leonidaus/mydata-finance:<commit sha> docker compose up -d
```
