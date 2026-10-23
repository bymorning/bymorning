#!/bin/sh
# Writes the PostgreSQL trust bundle (DATABASE_CA) for Azure Database for
# PostgreSQL flexible server: the two root CAs Microsoft documents for its
# dual-signed server certificates, DigiCert Global Root G2 and Microsoft RSA Root
# Certificate Authority 2017. Do not add intermediates or server certificates.
# Usage: sh fetch-postgres-ca.sh > postgres-ca.pem
# Verify the printed fingerprints against your own approved source before use.
set -eu
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL https://cacerts.digicert.com/DigiCertGlobalRootG2.crt.pem -o "$tmp/digicert.pem"
curl -fsSL "https://www.microsoft.com/pkiops/certs/Microsoft%20RSA%20Root%20Certificate%20Authority%202017.crt" -o "$tmp/microsoft.der"
openssl x509 -inform DER -in "$tmp/microsoft.der" -out "$tmp/microsoft.pem"
for f in digicert microsoft; do
  openssl x509 -in "$tmp/$f.pem" -noout -subject -fingerprint -sha256 | grep -E "^(subject|sha256)" >&2
  cat "$tmp/$f.pem"
done
