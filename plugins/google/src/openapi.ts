import { googleGmail } from "./google.js"

export const gmailOpenAPI = {
  openapi: "3.1.0",
  info: {
    title: "Gmail API tools",
    version: "v1",
  },
  servers: [{ url: googleGmail.apiURL }],
  security: [
    {
      googleOAuth: googleGmail.toolScopes,
    },
  ],
  components: {
    securitySchemes: {
      googleOAuth: {
        type: "oauth2",
        flows: {
          authorizationCode: {
            authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
            tokenUrl: "https://oauth2.googleapis.com/token",
            scopes: {
              [googleGmail.toolScopes[0]]: "Read Gmail messages and settings",
              [googleGmail.toolScopes[1]]: "Create and manage Gmail editors",
            },
          },
        },
      },
    },
    schemas: {
      Message: {
        type: "object",
        properties: {
          id: { type: "string" },
          threadId: { type: "string" },
          labelIds: { type: "array", items: { type: "string" } },
          snippet: { type: "string" },
          historyId: { type: "string" },
          internalDate: { type: "string" },
          payload: { type: "object", additionalProperties: true },
          raw: { type: "string" },
          sizeEstimate: { type: "integer" },
        },
        additionalProperties: true,
      },
      Editor: {
        type: "object",
        properties: {
          id: { type: "string" },
          message: { $ref: "#/components/schemas/Message" },
        },
        additionalProperties: true,
      },
      Label: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string" },
          messageListVisibility: { type: "string" },
          labelListVisibility: { type: "string" },
          messagesTotal: { type: "integer" },
          messagesUnread: { type: "integer" },
          threadsTotal: { type: "integer" },
          threadsUnread: { type: "integer" },
        },
        additionalProperties: true,
      },
    },
  },
  paths: {
    "/gmail/v1/users/{userId}/messages": {
      get: {
        operationId: "messages.search",
        summary: "Search Gmail messages",
        description:
          "Search messages using Gmail search syntax. Use userId=me for the authenticated account. The result contains message IDs; call messages.get to read a message.",
        security: [{ googleOAuth: [googleGmail.toolScopes[0]] }],
        parameters: [
          {
            name: "userId",
            in: "path",
            required: true,
            schema: { type: "string", default: "me" },
            description: "Email address or me for the authenticated account",
          },
          {
            name: "q",
            in: "query",
            schema: { type: "string" },
            description: "Gmail search query, such as from:alice@example.com newer_than:7d",
          },
          {
            name: "labelIds",
            in: "query",
            style: "form",
            explode: true,
            schema: { type: "array", items: { type: "string" } },
          },
          {
            name: "maxResults",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 500, default: 20 },
          },
          { name: "pageToken", in: "query", schema: { type: "string" } },
          { name: "includeSpamTrash", in: "query", schema: { type: "boolean", default: false } },
        ],
        responses: {
          "200": {
            description: "Matching messages",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    messages: { type: "array", items: { $ref: "#/components/schemas/Message" } },
                    nextPageToken: { type: "string" },
                    resultSizeEstimate: { type: "integer" },
                  },
                  additionalProperties: true,
                },
              },
            },
          },
        },
      },
    },
    "/gmail/v1/users/{userId}/messages/{id}": {
      get: {
        operationId: "messages.get",
        summary: "Get a Gmail message",
        description:
          "Read one Gmail message. Use userId=me for the authenticated account and format=full for headers and body parts.",
        security: [{ googleOAuth: [googleGmail.toolScopes[0]] }],
        parameters: [
          {
            name: "userId",
            in: "path",
            required: true,
            schema: { type: "string", default: "me" },
          },
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          {
            name: "format",
            in: "query",
            schema: { type: "string", enum: ["minimal", "full", "raw", "metadata"], default: "full" },
          },
          {
            name: "metadataHeaders",
            in: "query",
            style: "form",
            explode: true,
            schema: { type: "array", items: { type: "string" } },
          },
        ],
        responses: {
          "200": {
            description: "Gmail message",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Message" } } },
          },
        },
      },
    },
    "/gmail/v1/users/{userId}/threads/{id}": {
      get: {
        operationId: "threads.get",
        summary: "Get a Gmail thread",
        description: "Read every message in a Gmail thread. Use userId=me for the authenticated account.",
        security: [{ googleOAuth: [googleGmail.toolScopes[0]] }],
        parameters: [
          {
            name: "userId",
            in: "path",
            required: true,
            schema: { type: "string", default: "me" },
          },
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          {
            name: "format",
            in: "query",
            schema: { type: "string", enum: ["minimal", "full", "metadata"], default: "full" },
          },
          {
            name: "metadataHeaders",
            in: "query",
            style: "form",
            explode: true,
            schema: { type: "array", items: { type: "string" } },
          },
        ],
        responses: {
          "200": {
            description: "Gmail thread",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    historyId: { type: "string" },
                    messages: { type: "array", items: { $ref: "#/components/schemas/Message" } },
                  },
                  additionalProperties: true,
                },
              },
            },
          },
        },
      },
    },
    "/gmail/v1/users/{userId}/labels": {
      get: {
        operationId: "labels.list",
        summary: "List Gmail labels",
        description: "List labels in the authenticated Gmail account. Use userId=me.",
        security: [{ googleOAuth: [googleGmail.toolScopes[0]] }],
        parameters: [
          {
            name: "userId",
            in: "path",
            required: true,
            schema: { type: "string", default: "me" },
          },
        ],
        responses: {
          "200": {
            description: "Gmail labels",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    labels: { type: "array", items: { $ref: "#/components/schemas/Label" } },
                  },
                  additionalProperties: true,
                },
              },
            },
          },
        },
      },
    },
    "/gmail/v1/users/{userId}/editors": {
      get: {
        operationId: "editors.list",
        summary: "List Gmail editors",
        description: "List editors in the authenticated Gmail account. Use userId=me.",
        security: [{ googleOAuth: [googleGmail.toolScopes[1]] }],
        parameters: [
          {
            name: "userId",
            in: "path",
            required: true,
            schema: { type: "string", default: "me" },
          },
          { name: "q", in: "query", schema: { type: "string" } },
          {
            name: "maxResults",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 500, default: 20 },
          },
          { name: "pageToken", in: "query", schema: { type: "string" } },
          { name: "includeSpamTrash", in: "query", schema: { type: "boolean", default: false } },
        ],
        responses: {
          "200": {
            description: "Gmail editors",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    editors: { type: "array", items: { $ref: "#/components/schemas/Editor" } },
                    nextPageToken: { type: "string" },
                    resultSizeEstimate: { type: "integer" },
                  },
                  additionalProperties: true,
                },
              },
            },
          },
        },
      },
      post: {
        operationId: "editors.create",
        summary: "Create a Gmail editor",
        description:
          "Create, but do not send, a Gmail editor. raw must be a base64url-encoded RFC 2822 email containing headers such as To and Subject followed by the message body. Use userId=me.",
        security: [{ googleOAuth: [googleGmail.toolScopes[1]] }],
        parameters: [
          {
            name: "userId",
            in: "path",
            required: true,
            schema: { type: "string", default: "me" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["message"],
                properties: {
                  message: {
                    type: "object",
                    required: ["raw"],
                    properties: {
                      raw: {
                        type: "string",
                        description: "Base64url-encoded RFC 2822 email",
                      },
                      threadId: {
                        type: "string",
                        description: "Existing thread ID when creating a reply editor",
                      },
                    },
                    additionalProperties: false,
                  },
                },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Created editor",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Editor" } } },
          },
        },
      },
    },
  },
} as const
