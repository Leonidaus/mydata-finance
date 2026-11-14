# Deploying the demo

`main` is the persistent build. Every push to `main` runs `.github/workflows/deploy.yml`,
which publishes the Docker image to GitHub's container registry and, when a host is
configured, redeploys it there.

## One-time host setup

Any Linux machine with a public address and Docker works (for example a small CPU
instance on Verda or Aiven).

1. Install Docker with the compose plugin, and open ports 80 and 443.
2. Create the directory and copy the compose file:
   ```bash
   mkdir -p /srv/mydata/data
   scp deploy/docker-compose.yml <user>@<host>:/srv/mydata/
   ```
3. Copy the database. The full one is 663 MB; `build_database.py --keep-customers`
   makes a 2 MB one with only the demo customers (see the main README):
   ```bash
   scp data/out/finance.sqlite <user>@<host>:/srv/mydata/data/finance.sqlite
   ```
4. Create `/srv/mydata/.env` on the host:
   ```
   DOMAIN=203-0-113-7.sslip.io      # the host's address, or your own domain
   ```
   The service keys do not go here; the deploy workflow writes them (see below).
5. Let the host pull the image. Either make the package public (GitHub → the
   repository owner's Packages → mydata-finance → Package settings → Change
   visibility), or run `docker login ghcr.io` on the host with a token that can read
   packages.
6. Start it: `cd /srv/mydata && docker compose up -d`, then open `https://<DOMAIN>`.

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

On every deploy the workflow writes the service keys that are set to
`/srv/mydata/keys.env` on the host (readable only by the deploy user), and the app
container reads that file. A missing key just leaves that service off; `/api/health`
shows which are on. To change a key, update the secret and re-run the Deploy workflow.

The public half of the deploy key is in [`deploy_key.pub`](deploy_key.pub). Allow it on
the host, for the user the workflow logs in as:

```bash
ssh <user>@<host> 'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys' < deploy/deploy_key.pub
gh secret set DEPLOY_HOST --body "<host address>"
```

Without `DEPLOY_HOST` the workflow still publishes the image and skips the deploy. To
replace the key, generate a new pair, run `gh secret set DEPLOY_SSH_KEY < new_key`, and
update `deploy_key.pub` and the host's `authorized_keys`.

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
