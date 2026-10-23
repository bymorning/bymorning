# Identity provider setup

ByMorning signs users in with an OIDC confidential client using authorization code
with PKCE. The issuer must publish discovery at
`/.well-known/openid-configuration`.

Every Auth Provider has its own redirect URI, which includes the provider's ID:

```text
https://<app-host>/auth/callback/<providerID>
```

Setup allocates the ID and shows this URL before you save, so the order is:

1. Deploy with `WEB_COOKIE_KEY` set. Deployment-time OIDC settings are retired;
   there is nothing to set with `sst secret` for SSO.
2. Open Setup with the installation setup token and choose the provider
   preset. The token is never logged: the server writes it owner-read-only to
   its setup-token file at startup (the log line names the file; in the image
   it is `/tmp/bymorning/setup-token`), or the operator supplies it as
   `SETUP_TOKEN`. Copy the
   **Callback URL** it shows.
3. In your identity provider, create a **web/confidential OIDC client**, enable
   the **authorization-code** grant, register that callback URL exactly, request
   `openid email profile`, and assign the users or groups allowed to use
   ByMorning.
4. Back in Setup, enter the issuer (or tenant ID for Microsoft Entra), client
   ID, client secret, and admitted email domains, then register the provider.

Admitted domains are a comma-separated list of lower-case bare domains, such as
`example.com, example.org`. Replace the connection later through
Settings → Security (Auth Provider), which shows the same callback URL. The
local host always uses Local Login and never needs this setup.

The login page shows one **Continue with <provider name>** button per enabled
Auth Provider. Deploy first:

```sh
bunx sst deploy --stage <stage>
```

then complete Setup in the browser.

## Okta

In **Applications → Applications**, create an **OIDC Web Application**. Enable
Authorization Code, add the callback URL from Setup, request `openid email
profile`, and assign the intended users or groups.

In Setup, enter the issuer `https://<org>.okta.com`, the Okta client ID and
client secret, the Okta preset, and the admitted domains.

Use `https://<org>.okta.com/oauth2/<authorization-server-id>` instead if that
is the issuer shown in its discovery document.

## Microsoft Entra ID

Full steps, including Azure Government, are in the public docs page
`packages/docs/src/07-configure/10-microsoft-entra.mdx`. In short: create a
single-tenant **Web** app registration with the callback URL from Setup, set the
token version to v2, add the optional ID token claims `email` and `xms_edov`,
create a client secret, and in Setup choose the Microsoft Entra preset, the
cloud (Commercial or Azure Government), and enter the tenant ID.

Setup derives the issuer `https://login.microsoftonline.com/<tenant-id>/v2.0`
(Commercial) or `https://login.microsoftonline.us/<tenant-id>/v2.0` (Azure
Government). Entra ID tokens carry no `email_verified`; ByMorning accepts the
`xms_edov` claim instead, so the `email` and `xms_edov` optional claims are
required.

## Google Workspace

In Google Cloud, create an **OAuth client ID** of type **Web application**.
Add the callback URL from Setup, configure the consent screen for the Workspace
organization, use scopes `openid email profile`, and restrict access through
Workspace application access or group policy.

In Setup, enter the issuer `https://accounts.google.com`, the Google OAuth
client ID and client secret, the Google preset, and the admitted domains.

## AWS IAM Identity Center

IAM Identity Center exposes SAML for custom applications. Create a Cognito user
pool as the SAML-to-OIDC bridge: add IAM Identity Center as its SAML identity
provider, map a stable subject and email, and create a **confidential** user-pool
app client. Enable authorization code, scopes `openid email profile`, add the
callback URL from Setup, and assign users or groups to the IAM Identity Center
application. Treat the Cognito pool as the OIDC issuer.

In Setup, enter the issuer
`https://cognito-idp.<region>.amazonaws.com/<user-pool-id>`, the Cognito app
client ID and client secret, the matching preset, and the admitted domains.

## Any other OIDC provider

Create a web/confidential client with authorization code, the callback URL from
Setup, and scopes `openid email profile`; assign the intended users or groups. Confirm
that discovery, token exchange, JWKS, and (when email is absent from the ID
token) `userinfo` are available.

In Setup, enter the issuer `https://<issuer>`, the client ID and client secret,
the Custom preset, and the admitted domains.

## Troubleshooting

| Log `reason` / symptom                | Check                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discovery`                           | The configured issuer exactly matches discovery's `issuer`, is HTTPS, and publishes required endpoints.                                                                   |
| `exchange`                            | The client secret, authorization-code grant, and callback are correct; the authorization code is unused.                                                                  |
| `token`                               | ID-token signature/JWKS, issuer, audience, expiry, and nonce match the configured client.                                                                                 |
| `claims`                              | The ID token has a non-empty `sub` and a valid email address.                                                                                                             |
| `userinfo`                            | The access token can call userinfo and its `sub` and email agree with the ID token.                                                                                       |
| Provider says `redirect_uri` mismatch | Register exactly the callback URL Setup or Settings → Security shows, `https://<app-host>/auth/callback/<providerID>`; host, scheme, path, and trailing slash must match. |
