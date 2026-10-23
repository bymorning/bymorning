# Sourced by test/image-boot.sh and test/image-security.sh in TARBALL mode: the
# release-candidate path that tests the exact artifact script/release.ts wrote.
#
#   oci_load <tarball> <release-dir> <work-dir>
#
# Reads <release-dir>/manifest.json, refuses a tarball whose name or recorded
# digest disagree with it, has fixtures/oci-archive.mjs vet the archive (safe
# members, one linux/amd64 manifest with the recorded digest, every blob's
# sha256 and size, labels, user, command, port) BEFORE anything is loaded, then
# `docker load`s the OCI layout (re-wrapped in docker-save format from the same
# verified blobs when the daemon lacks the containerd image store) and tags it
# bymorning-candidate:<digest>. On success it sets:
#   image            the tag to run
#   expect_version   the manifest's version (the image's version label must match)
#   expect_commit    the manifest's source commit
#   oci_facts        the JSON facts oci-archive.mjs printed
# Any disagreement exits 1. Needs node, jq and tar.
oci_load() { # tarball release-dir work-dir
  _tarball=$1 _release=$2 _work=$3
  _root=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
  oci_die() { echo "oci load: $1" >&2; exit 1; }
  [ -f "$_tarball" ] || oci_die "TARBALL $_tarball does not exist"
  command -v node >/dev/null || oci_die "node is required to verify the archive"
  command -v jq >/dev/null || oci_die "jq is required to read the release manifest"
  _record="$_release/manifest.json"
  [ -f "$_record" ] || oci_die "$_record is missing; cannot verify $_tarball"
  _digest=$(jq -er .artifacts.gateway.digest "$_record") || oci_die "$_record lacks the gateway digest"
  expect_version=$(jq -er .version "$_record") || oci_die "$_record lacks a version"
  _name=$(jq -er .artifacts.gateway.tarball "$_record") || oci_die "$_record lacks the gateway tarball"
  expect_commit=$(jq -er .commit "$_record") || oci_die "$_record lacks the source commit"
  [ "$(basename "$_tarball")" = "$_name" ] || oci_die "tarball name $(basename "$_tarball") is not the recorded $_name"
  [ "$_name" = "bymorning-$expect_commit.tar" ] || oci_die "recorded tarball name and source commit disagree"
  oci_facts=$(node "$_root/packages/server/test/fixtures/oci-archive.mjs" "$_tarball" \
    --digest "$_digest" --version "$expect_version" --commit "$expect_commit" \
    --extract "$_work/oci") || oci_die "archive rejected before load"
  _config=$(printf '%s' "$oci_facts" | node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).config')
  _layout="$_work/oci"
  _rewrapped=0
  if ! _output=$(docker load -i "$_tarball" 2>&1); then
    # A Docker daemon without the containerd image store cannot read an OCI
    # layout. Re-wrap the layout oci-archive.mjs just verified (the same config
    # and layer blobs, every sha256 checked) in the docker-save format and load
    # that; the loaded image ID is the config digest and is checked below.
    _rewrapped=1
    _layers=$(jq -r '.layers[].digest | "blobs/sha256/" + ltrimstr("sha256:")' "$_layout/blobs/sha256/${_digest#sha256:}") \
      || oci_die "cannot read the layer list from the verified layout"
    # shellcheck disable=SC2086 # digests contain no whitespace; one positional argument each
    jq -n --arg config "blobs/sha256/${_config#sha256:}" '[{Config: $config, RepoTags: null, Layers: $ARGS.positional}]' --args $_layers >"$_layout/manifest.json"
    tar -cf "$_work/docker-format.tar" -C "$_layout" manifest.json blobs
    _output=$(docker load -i "$_work/docker-format.tar" 2>&1) || oci_die "docker load failed for the OCI layout and for its docker-format re-wrap: $_output"
  fi
  _loaded=$(printf '%s\n' "$_output" | sed -n 's/^Loaded image ID: //p;s/^Loaded image: //p' | tail -1)
  [ -n "$_loaded" ] || oci_die "docker load did not report an image: $_output"
  _id=$(docker image inspect "$_loaded" --format '{{.Id}}')
  case "$_id" in
    "$_digest" | "$_config") ;;
    *)
      # A containerd-store daemon files a docker-format load under a manifest
      # of its own; the image is still acceptable only if its root filesystem
      # is exactly the verified config's layer list.
      [ "$_rewrapped" = 1 ] || oci_die "loaded image $_id is neither the manifest $_digest nor the config $_config"
      _want=$(jq -c '.rootfs.diff_ids' "$_layout/blobs/sha256/${_config#sha256:}")
      _have=$(docker image inspect "$_id" --format '{{json .RootFS.Layers}}')
      [ "$_want" = "$_have" ] || oci_die "loaded image $_id is neither the manifest $_digest nor the config $_config, and its layers differ from the verified config"
      ;;
  esac
  image="bymorning-candidate:${_digest#sha256:}"
  docker tag "$_id" "$image"
}
