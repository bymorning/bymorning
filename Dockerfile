# The ByMorning Gateway image: one host program (app/host) bound to a cloud at
# startup by the deployer's environment (STORAGE_PROVIDER, CIPHER_BACKEND, and
# their companions; see app/host/README.md). Both cloud backends and both
# production Code Interpreter plugins ship in every image.

# The bundle is architecture-independent; build natively and only target the runtime platform.
# oven/bun:1.3.11 (multi-arch index digest)
FROM --platform=$BUILDPLATFORM oven/bun:1.3.11@sha256:0733e50325078969732ebe3b15ce4c4be5082f18c4ac1a0f0ca4839c2e4e42a7 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile && bun run --cwd app/host build && cp -r app/host/dist /app/dist

# The AWS RDS CA bundle, so DATABASE_URL can require sslmode=verify-full (the
# an ECS task definition sets sslrootcert=/app/certs/rds-global-bundle.pem). AWS
# publishes one global bundle per partition and neither covers the other:
#   commercial  truststore.pki.rds.amazonaws.com: the commercial AWS Regions
#               (114 certificates as pinned; sa-west-1 roots added 2026-10-16)
#   GovCloud    truststore.pki.us-gov-west-1.rds.amazonaws.com: us-gov-west-1
#               and us-gov-east-1 (10 certificates: 6 roots, 4 intermediates)
# The image ships their concatenation (124 certificates) at one path so the
# same DATABASE_URL works in either partition. Each download is pinned by
# sha256 (fail closed when AWS rotates a bundle); refresh with
# `sh script/security/rds-bundle.sh`, which shows the certificate diff, then
# update the checksum and rebuild. Only the concatenated file reaches the runtime, and
# its mtime is fixed to SOURCE_DATE_EPOCH so the layer stays reproducible.
# Azure deployments ignore it and supply DATABASE_CA instead.
FROM --platform=$BUILDPLATFORM oven/bun:1.3.11@sha256:0733e50325078969732ebe3b15ce4c4be5082f18c4ac1a0f0ca4839c2e4e42a7 AS certs
ARG SOURCE_DATE_EPOCH
ADD --checksum=sha256:90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /certs/commercial.pem
ADD --checksum=sha256:bae59f78f2e2ba789e734cdcac78c13a0f0e99aa3f7bd49f1f37477c815b9b33 https://truststore.pki.us-gov-west-1.rds.amazonaws.com/global/global-bundle.pem /certs/govcloud.pem
RUN cat /certs/commercial.pem /certs/govcloud.pem > /certs/rds-global-bundle.pem \
    && touch -d "@${SOURCE_DATE_EPOCH:-0}" /certs/rds-global-bundle.pem

# Runtime: Red Hat UBI 9 Node.js 22 (minimal). Red Hat links Node against the
# shared system OpenSSL and ships the RHEL 9 OpenSSL FIPS Provider in the image
# (openssl-fips-provider, FIPS 140-3 CMVP certificate #4857), so every Node
# crypto operation runs on a validated module once the provider is activated.
# RHEL's Node build refuses --enable-fips/--force-fips; OPENSSL_CONF activation
# is the supported mechanism and fails closed when the module cannot load.
# registry.access.redhat.com/ubi9/nodejs-22-minimal:latest (manifest-list digest, 2026-10-27; re-pinned for 1.3.1:
# the 2026-09-26 pin carried a Critical ca-certificates advisory that this image fixes)
FROM registry.access.redhat.com/ubi9/nodejs-22-minimal@sha256:dcbe5b45a3e7591a52fe4ae0092a39910924092feee749c040424a7a4519ffd2 AS base

# Release identity, stamped by script/release.ts from the root
# package.json version and the source commit. SOURCE_DATE_EPOCH is consumed by
# BuildKit itself to rewrite image and layer timestamps for reproducible builds.
ARG BYMORNING_VERSION=0.0.0
ARG REVISION=unknown
ARG CREATED=1970-01-01T00:00:00Z
ARG SOURCE_DATE_EPOCH

USER root
# libxml2: the pinned base (latest as of 2026-09-26) still ships 2.9.13-14.el9_8.4;
# pull the fixed 2.9.13-14.el9_8.5 from the UBI 9 BaseOS repo to remediate
# CVE-2026-74860 and CVE-2026-86140 until Red Hat rebuilds the image.
# The runtime must not ship a JavaScript package manager: `microdnf remove npm`
# drops the npm/npx entrypoints, but the nodejs RPM still owns npm's bundled
# dependency tree (pacote, tar, picomatch, @sigstore/*) under
# /usr/lib/node_modules/npm and nodejs-nodemon ships a second tree; remove both
# so no development tooling or its flaggable dependencies remain in the image.
RUN microdnf update -y libxml2 \
    && microdnf remove -y npm nodejs-nodemon \
    && rm -rf /usr/lib/node_modules/npm \
    && microdnf clean all
COPY app/host/openssl-fips.cnf /etc/pki/tls/openssl-fips.cnf

WORKDIR /app
COPY --from=build /app/dist/ /app/
# The commercial + GovCloud RDS CA bundle (see the certs stage), installed
# world-readable so the runtime user (uid 65532) can read it.
COPY --from=certs --chmod=0644 /certs/rds-global-bundle.pem /app/certs/rds-global-bundle.pem
# --chmod also strips the execute bit from the auto-created parent directory;
# restore traversal so uid 65532 can reach the bundle.
RUN chmod 0755 /app/certs
USER 65532:65532
EXPOSE 3210

# The container must be reachable by its load balancer, Ingress, or proxy, so
# it listens on all interfaces. Everything else that binds the image to a cloud
# (selectors, FIPS endpoint routing, trust anchors) is deployment environment.
ENV OPENSSL_CONF=/etc/pki/tls/openssl-fips.cnf \
    BYMORNING_VERSION=$BYMORNING_VERSION \
    HOME=/tmp \
    HOST=0.0.0.0

LABEL org.opencontainers.image.title="ByMorning Gateway" \
      org.opencontainers.image.description="ByMorning enterprise Gateway (UI + API), FIPS 140-3 validated cryptography via the RHEL 9 OpenSSL FIPS Provider (CMVP #4857)." \
      org.opencontainers.image.vendor="ByMorning" \
      org.opencontainers.image.version="$BYMORNING_VERSION" \
      org.opencontainers.image.source="https://github.com/bymorning/bymorning" \
      org.opencontainers.image.revision="$REVISION" \
      org.opencontainers.image.created="$CREATED" \
      org.opencontainers.image.base.name="registry.access.redhat.com/ubi9/nodejs-22-minimal" \
      org.opencontainers.image.base.digest="sha256:dcbe5b45a3e7591a52fe4ae0092a39910924092feee749c040424a7a4519ffd2"

CMD ["node", "/app/bymorning.mjs"]
