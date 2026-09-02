#!/usr/bin/env bash
#
# Cut a release: bump versions, tag, let GitHub Actions publish to ghcr.io,
# then mirror the finished image to the Gitea registry.
#
#   ./scripts/release.sh 1.1.5
#
# Needs: git, docker (logged in to gitea.cyfox.dev), curl, python3.
# A GitHub login is NOT needed - Actions builds and pushes to ghcr.io by itself.

set -euo pipefail

VERSION="${1:-}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: $0 <version>   e.g. $0 1.1.5" >&2
  exit 1
fi
TAG="v$VERSION"

GH_IMAGE="ghcr.io/xinua/retriever"
GITEA_IMAGE="gitea.cyfox.dev/denny/retriever"
REPO="xinua/retriever"

cd "$(git rev-parse --show-toplevel)"

# --- sanity checks -----------------------------------------------------------
if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is dirty - commit or stash first" >&2
  exit 1
fi
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "error: tag $TAG already exists" >&2
  exit 1
fi

echo "==> bumping to $VERSION"
# The root package.json is the single source of truth. generate-version.mjs
# copies it into the backend/frontend manifests, the Dockerfile label and the
# header chip's version.const.ts, so the whole bump lands in one commit.
python3 - "$VERSION" <<'PY'
import re,sys
v=sys.argv[1]
s=open('package.json').read()
s=re.sub(r'("version":\s*")[0-9]+\.[0-9]+\.[0-9]+(")', rf'\g<1>{v}\g<2>', s, count=1)
open('package.json','w').write(s)
PY
node scripts/generate-version.mjs

git --no-pager diff --stat

echo "==> committing and pushing to both remotes"
git add -A
git commit -m "Release $TAG"
git push origin main
git push gitea main

echo "==> tagging $TAG"
git tag -a "$TAG" -m "Retriever $TAG"
git push origin "$TAG"      # this is what triggers the GHCR build
git push gitea  "$TAG"

# --- wait for the GitHub Actions build --------------------------------------
echo "==> waiting for GitHub Actions to publish $GH_IMAGE:$VERSION"
sleep 10
RUN_ID=""
for _ in $(seq 1 12); do
  RUN_ID=$(curl -fsS "https://api.github.com/repos/$REPO/actions/runs?per_page=10" \
    | python3 -c "
import json,sys
for r in json.load(sys.stdin).get('workflow_runs',[]):
    if r['head_branch']=='$TAG': print(r['id']); break") || true
  [[ -n "$RUN_ID" ]] && break
  sleep 5
done
if [[ -z "$RUN_ID" ]]; then
  echo "error: no workflow run found for $TAG - check the Actions tab" >&2
  exit 1
fi
echo "    run: https://github.com/$REPO/actions/runs/$RUN_ID"

while :; do
  read -r STATUS CONCLUSION < <(curl -fsS "https://api.github.com/repos/$REPO/actions/runs/$RUN_ID" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status'), d.get('conclusion'))")
  printf '    %s %s\n' "$STATUS" "$CONCLUSION"
  [[ "$STATUS" == "completed" ]] && break
  sleep 20
done
if [[ "$CONCLUSION" != "success" ]]; then
  echo "error: build $CONCLUSION - nothing mirrored. See the run above." >&2
  exit 1
fi

# --- mirror to Gitea ---------------------------------------------------------
# imagetools copies the manifest list as-is, so Gitea ends up byte-identical to
# ghcr rather than a separate rebuild. Blobs shared with the previous release
# are skipped, so this is fast after the first time.
echo "==> mirroring to $GITEA_IMAGE"
MAJOR="${VERSION%%.*}"
MINOR="${VERSION%.*}"
docker buildx imagetools create \
  -t "$GITEA_IMAGE:$VERSION" \
  -t "$GITEA_IMAGE:latest" \
  "$GH_IMAGE:$VERSION"

# --- verify ------------------------------------------------------------------
A=$(docker buildx imagetools inspect "$GH_IMAGE:$VERSION"    --format '{{.Manifest.Digest}}')
B=$(docker buildx imagetools inspect "$GITEA_IMAGE:$VERSION" --format '{{.Manifest.Digest}}')
echo "    ghcr : $A"
echo "    gitea: $B"
if [[ "$A" != "$B" ]]; then
  echo "error: digests differ - the mirror did not land correctly" >&2
  exit 1
fi

echo
echo "$TAG published to both registries."
echo "  docker pull $GH_IMAGE:$VERSION"
echo "  docker pull $GITEA_IMAGE:$VERSION"
