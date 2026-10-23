export const googleGmail = {
  pluginID: "google.gmail.openapi",
  integrationID: "google-gmail",
  methodID: "oauth",
  authorizationURL: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenURL: "https://oauth2.googleapis.com/token",
  userInfoURL: "https://openidconnect.googleapis.com/v1/userinfo",
  apiURL: "https://gmail.googleapis.com",
  toolScopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"],
  authorizationScopes: [
    "openid",
    "email",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
  ],
} as const
