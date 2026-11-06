---
title: Cover Letter
---

# Cover Letter

To: The customer's security team\
From: The ByMorning project\
Date: {{RELEASE_DATE}}\
Re: Security review package for ByMorning {{VERSION}}

This package supports a security review of ByMorning {{VERSION}} by an
organization that deploys and operates it, referred to throughout as the
customer. It describes the controls that apply if the customer's deployment
processes Controlled Unclassified Information (CUI), including ITAR- and
EAR-controlled technical data; whether it does is the customer's decision.

ByMorning is delivered as one digest-pinned OCI image, available as an OCI
tarball on the GitHub release or from `ghcr.io/bymorning/bymorning`, together
with the open-source AWS or Azure installer from the ByMorning repository. The
customer deploys and operates it entirely in its own cloud account, and the
ByMorning team has no access to the deployed environment. The image digest
below identifies the software under review; this package applies to that
digest and to no other build.

## Release identification

| Item | Value |
| ---- | ----- |
| Product | ByMorning {{VERSION}}, released {{RELEASE_DATE}} |
| Source commit | `{{SOURCE_COMMIT}}` |
| Image digest | `{{IMAGE_DIGEST}}` |
| Image tarball | `{{TARBALL_NAME}}` (sha256 `{{TARBALL_SHA256}}`) |
| Registry | `ghcr.io/bymorning/bymorning`, version tag, same digest |
| Delivery | The image (tarball or registry) plus the AWS installer (Terraform) or the Azure installer (Terraform and Kubernetes manifests) |
| Runtime | One Node 22 process (server, embedded web UI, migrations, bundled plugins) on ECS Fargate or Azure Kubernetes Service |
| Target | The customer's AWS account (AWS GovCloud (US) or a commercial AWS Region) or Azure subscription (Azure Government or Azure) |

Release evidence (SBOMs, vulnerability scans and OpenVEX dispositions, SAST and
secret-scan output, SLSA provenance, Sigstore signatures, and signed checksums)
is published with each GitHub release. The signatures are keyless: they bind
the evidence to the ByMorning release workflow identity named in
`signer.txt` and are recorded in the public Rekor transparency log. §15 lists
each file with its checksum and the offline verification commands. The AWS
installer rejects tag-only image references; the Azure installer's documented
procedure deploys the image by the digest printed when it is mirrored.

## Handling and support

This package is public. It carries no proprietary marking, requires no
non-disclosure agreement, and contains no CUI.

ByMorning is open source under the MIT License and community maintained, with
no support commitment or service level (§13). Security patches and vulnerability notifications depend on the
maintainers of the public repository. Vulnerabilities are reported privately
through GitHub Security, Report a vulnerability. Questions and requests for
further evidence go to the issue tracker.
