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
   GEMINI_API_KEY=...
   ELEVENLABS_API_KEY=...
   ```
5. Let the host pull the image. Either make the package public (GitHub → the
   repository owner's Packages → mydata-finance → Package settings → Change
   visibility), or run `docker login ghcr.io` on the host with a token that can read
   packages.
6. Start it: `cd /srv/mydata && docker compose up -d`, then open `https://<DOMAIN>`.

## Automatic redeploys

Add three repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | The host's address |
| `DEPLOY_USER` | The SSH user (defaults to `root`) |
| `DEPLOY_SSH_KEY` | A private key whose public half is in that user's `authorized_keys` |

Without `DEPLOY_HOST` the workflow still publishes the image and skips the deploy.

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
