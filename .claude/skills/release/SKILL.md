---
name: release
description: Prepare a release pull request from develop into main. Use when the user asks to prepare, open, or update a release. Never merges the release or starts a deployment.
---

# Prepare a release

Open or reuse the pull request that promotes `develop` into `main`. Review, merging,
and deployment are manual. Do not push directly to either branch, merge the pull
request, or trigger the Deploy workflow.

## Steps

1. Fetch the current remote branches without changing the user's checkout:

   ```bash
   git fetch origin develop main
   ```

2. Compare the branches:

   ```bash
   git rev-list --count origin/main..origin/develop
   git rev-list --count origin/develop..origin/main
   ```

   The first count is the number of commits to release. If it is zero, report that
   `main` is already up to date and stop. If the second count is nonzero, `main` has
   commits that are not in `develop`; stop and ask the user to reconcile the branches
   instead of opening a conflicting release.

3. Check for an existing open release pull request:

   ```bash
   gh pr list --base main --head develop --state open --json number,url
   ```

   If one exists, it already tracks the latest `develop`. Report its URL and stop;
   do not open a duplicate.

4. Collect the changes being released:

   ```bash
   git log --no-merges --oneline origin/main..origin/develop
   ```

   Use these commits to write a concise release summary and set it as `RELEASE_BODY`.
   Create the pull request with `develop` as the head and `main` as the base:

   ```bash
   gh pr create --base main --head develop --title "Release develop to main" --body "$RELEASE_BODY"
   ```

   Include the change summary and a reminder that CI must pass before merging. Mention
   that merging into `main` automatically starts the Deploy workflow.

5. Return the pull request URL. Clearly state that the release has only been prepared,
   not merged or deployed.
