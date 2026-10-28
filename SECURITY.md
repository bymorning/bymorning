# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub: **Security → Report a vulnerability** on
this repository. If you cannot use that, email security@bymorning.ai.

Include the affected version or commit, a description, reproduction steps, and
the impact you expect. You will get an acknowledgement within three business
days. We will keep you informed while we investigate, tell you when a fix
ships, and credit you if you want to be named.

## Supported versions

Security fixes go to the latest release and the `dev` branch.

## Scope

The Gateway, web application, plugins, and the installers in this repository.
Reports about a third-party dependency are best sent to that project; tell us
too if ByMorning is affected.

## Verifying a release

Release images and their evidence are signed keylessly with [Sigstore](https://www.sigstore.dev): there is no key to
trust. A signature is genuine when its certificate names the `full-gate.yml` workflow of this repository running on a
`v*` tag, and the release's `signer.txt` records that identity. With `cosign`:

```sh
cosign verify-blob --bundle <file>.bundle \
  --certificate-identity-regexp '^https://github\.com/bymorning/bymorning/\.github/workflows/full-gate\.yml@refs/tags/v[0-9]+\.[0-9]+\.[0-9]+' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com <file>
```

Builds are reproducible, so you can also rebuild a release from its tag and compare image digests.
