#!/usr/bin/env python3
"""Upload this complete release to a review branch using the user's GitHub CLI login.

Dry run is the default. --push writes one commit on a non-default branch and opens
(or reuses) a pull request. It never merges, force-pushes, or changes Pages settings.
Only release-manifest.json files are uploaded; stale images/ files are removed.
Requires Python 3.10+ and an authenticated `gh` CLI. No tokens are read or logged.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path, PurePosixPath
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = "abtrk95/Chamsine-Catalog"
DEFAULT_BRANCH = "catalog-refresh-2026-10-24"

class PublishError(RuntimeError):
    pass


def release_files(root: Path = ROOT) -> dict[str, bytes]:
    manifest = json.loads((root / "release-manifest.json").read_text(encoding="utf-8"))
    result: dict[str, bytes] = {}
    for name, expected in manifest["files"].items():
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] == ".git":
            raise PublishError(f"Unsafe release path: {name}")
        local = root.joinpath(*path.parts)
        if local.is_symlink() or not local.is_file():
            raise PublishError(f"Release file is missing or is a symlink: {name}")
        if not local.resolve().is_relative_to(root.resolve()):
            raise PublishError(f"Release path escapes its folder: {name}")
        raw = local.read_bytes()
        if hashlib.sha256(raw).hexdigest() != expected:
            raise PublishError(f"Checksum mismatch: {name}; do not publish a partial or modified release.")
        result[name] = raw
    result["release-manifest.json"] = (root / "release-manifest.json").read_bytes()
    catalog = json.loads(result["data/products.json"])
    for product in catalog["products"]:
        if product["image"] not in result:
            raise PublishError(f"Missing product image: {product['image']}")
    for required in ("index.html", "assets/auth.js", "assets/store.js", "assets/order-pdf.js", ".nojekyll"):
        if required not in result:
            raise PublishError(f"Missing runtime file: {required}")
    return result


def git_blob_sha(raw: bytes) -> str:
    return hashlib.sha1(f"blob {len(raw)}\0".encode() + raw).hexdigest()


def api(endpoint: str, method: str = "GET", payload: dict | None = None, allow_404: bool = False):
    command = ["gh", "api", "--hostname", "github.com", "--method", method,
               "-H", "Accept: application/vnd.github+json", endpoint]
    if payload is not None:
        command += ["--input", "-"]
    for attempt in range(3):
        try:
            completed = subprocess.run(command, input=json.dumps(payload) if payload is not None else None,
                                       text=True, encoding="utf-8", capture_output=True, timeout=120)
        except subprocess.TimeoutExpired as exc:
            raise PublishError(f"GitHub request timed out: {method} {endpoint}. No branch is updated until the final step.") from exc
        if completed.returncode == 0:
            return json.loads(completed.stdout) if completed.stdout.strip() else None
        error = completed.stderr.strip()
        if allow_404 and "HTTP 404" in error:
            return None
        if attempt < 2 and ("HTTP 5" in error or "HTTP 429" in error):
            time.sleep(5 * (attempt + 1))
            continue
        raise PublishError(f"GitHub request failed ({method} {endpoint}): {error}")
    raise PublishError("GitHub did not complete the request")


def upload(branch: str, files: dict[str, bytes]) -> None:
    if not shutil.which("gh"):
        raise PublishError("GitHub CLI is not installed. Install gh, then run `gh auth login` and retry.")
    if branch in {"main", "master"} or not branch or any(ch.isspace() for ch in branch):
        raise PublishError("Choose a review branch, not main or master.")
    prefix = f"repos/{REPOSITORY}"
    metadata = api(prefix)
    base = metadata["default_branch"]
    if branch == base:
        raise PublishError("Refusing to write directly to the default branch.")
    branch_path = quote(branch, safe="/")
    ref_endpoint = f"{prefix}/git/ref/heads/{branch_path}"
    ref = api(ref_endpoint, allow_404=True)
    if ref is None:
        base_ref = api(f"{prefix}/git/ref/heads/{quote(base, safe='/')}")
        api(f"{prefix}/git/refs", "POST", {"ref": f"refs/heads/{branch}", "sha": base_ref["object"]["sha"]})
        ref = api(ref_endpoint)
    head_sha = ref["object"]["sha"]
    commit = api(f"{prefix}/git/commits/{head_sha}")
    tree = api(f"{prefix}/git/trees/{commit['tree']['sha']}?recursive=1")
    if tree.get("truncated"):
        raise PublishError("The repository tree is truncated; refusing an incomplete update.")
    old = {item["path"]: item for item in tree["tree"] if item["type"] == "blob"}
    known_blobs = {item["sha"] for item in old.values()}
    changes = []
    for number, (name, raw) in enumerate(sorted(files.items()), 1):
        expected_sha = git_blob_sha(raw)
        if old.get(name, {}).get("sha") == expected_sha:
            continue
        if expected_sha not in known_blobs:
            blob = api(f"{prefix}/git/blobs", "POST", {"content": base64.b64encode(raw).decode("ascii"), "encoding": "base64"})
            if blob["sha"] != expected_sha:
                raise PublishError(f"Uploaded blob checksum mismatch: {name}")
            known_blobs.add(expected_sha)
            # Keep request rates modest on private repositories.
            time.sleep(0.8)
        changes.append({"path": name, "mode": "100644", "type": "blob", "sha": expected_sha})
        print(f"Verified {number}/{len(files)}: {name}", flush=True)
    # The request explicitly replaces the old product image collection, not other directories.
    for name in old:
        if name.startswith("images/") and name not in files:
            changes.append({"path": name, "mode": "100644", "type": "blob", "sha": None})
    if changes:
        new_tree = api(f"{prefix}/git/trees", "POST", {"base_tree": commit["tree"]["sha"], "tree": changes})
        new_commit = api(f"{prefix}/git/commits", "POST", {
            "message": "Refresh Arabic catalog, password screen and PDF order sharing",
            "tree": new_tree["sha"], "parents": [head_sha]})
        if api(ref_endpoint)["object"]["sha"] != head_sha:
            raise PublishError("The review branch changed during upload. No branch update was made. Run again to rebase the release on its latest state.")
        api(f"{prefix}/git/refs/heads/{branch_path}", "PATCH", {"sha": new_commit["sha"], "force": False})
        print(f"Committed complete release: {new_commit['sha']}")
    else:
        print("The review branch already contains this release.")
    pull_requests = api(f"{prefix}/pulls?state=open&head={quote(REPOSITORY.split('/')[0]+':'+branch, safe='')}")
    if pull_requests:
        pull_request = pull_requests[0]
    else:
        pull_request = api(f"{prefix}/pulls", "POST", {
            "title": "Refresh catalog, minimal storefront and Arabic PDF orders",
            "head": branch, "base": base,
            "body": "Imports all 229 supplied products and 223 optimized local images. Adds the agreed convenience PIN screen and one primary Arabic PDF order-sharing action. See README.md and TESTING.md for source gaps, security limitations, test scope, and the required real-device sharing checks. No admin dashboard or customer form.\n\nThe full release includes the binary image assets; do not merge a partial upload."})
    print(f"Review: {pull_request['html_url']}")
    print("The default branch and hosting settings have not changed. Review and merge the pull request to apply this release.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--push", action="store_true", help="Upload the full release and open a pull request; never merge it")
    parser.add_argument("--branch", default=DEFAULT_BRANCH, help="Non-default review branch to update")
    args = parser.parse_args()
    try:
        files = release_files()
        print(f"Verified {len(files)} release files ({sum(map(len, files.values()))/1_000_000:.2f} MB).")
        print(f"Target: {REPOSITORY}, review branch: {args.branch}")
        if args.push:
            upload(args.branch, files)
        else:
            print("Dry run only. Run `python3 tools/publish.py --push` to upload using your gh login.")
        return 0
    except (PublishError, OSError, ValueError, KeyError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
