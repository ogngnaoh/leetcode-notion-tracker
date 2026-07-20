# Security and privacy

## Secrets

`NOTION_TOKEN` exists only in `.env` on the machine running the bridge and setup script.

The extension stores:

- Bridge URL
- Personal bridge token
- Default language

The bridge token authorizes only the narrow bridge endpoint. It is not a Notion credential.

## Local-first default

The bridge binds to `127.0.0.1`, not every network interface. The extension manifest grants bridge access only to localhost on port 8787.

## LeetCode access

The extension reads only the active `leetcode.com/problems/*` page after Chrome injects the declared content script. It does not:

- Read cookies
- Intercept network traffic
- Call undocumented LeetCode APIs
- Crawl other problems
- Send data without a user-confirmed form submission

## Before remote deployment

Remote deployment is outside the MVP. Before exposing the bridge publicly, add:

- HTTPS
- Origin allowlisting
- Rotatable device credentials
- Request-size limits
- Rate limiting
- Structured secret-safe logging
- Deployment-specific host permissions in `manifest.json`
