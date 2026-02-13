# OpenClaw Mail Channel

A lightweight email channel for [OpenClaw](https://github.com/openclaw/openclaw) that bridges email and AI conversations.

**Receive via AgentMail webhook → Process in OpenClaw session → Reply via Resend**

## Architecture

```
Incoming Email (AgentMail)
         ↓
Extract sender → Lookup userId in identityLinks
         ↓
Query sessions.json for UUID
         ↓
Forward to OpenClaw session (agent:main:{userId})
         ↓
Agent response → Send reply via Resend
```

## Quick Start

### 1. Configuration

Copy the example config:

```bash
cp config.example.json config.json
```

Edit `config.json`:

```json
{
  "agentMail": {
    "apiKey": "am_your_agentmail_key",
    "inboxId": "your-inbox@agentmail.to"
  },
  "resend": {
    "apiKey": "re_your_resend_key",
    "fromEmail": "ai@yourdomain.com"
  }
}
```

**Why two services?**

- **AgentMail**: Reliable inbound email reception (webhook)
- **Resend**: Reliable outbound email delivery (bypasses SES limitations)

### 2. Configure OpenClaw Identity Mapping

Edit `~/.openclaw/openclaw.json`:

```json5
{
  session: {
    identityLinks: {
      alice: [
        "email:alice@example.com"
      ],
      bob: [
        "email:bob@example.com",
        "email:bob.smith@work.com"
      ]
    }
  }
}
```

### 3. Create User Sessions (Important!)

**Each user must have a session created before emails will work.**

Create sessions via CLI:

```bash
# Create session for alice
openclaw agent --session-id "agent:main:alice" --message "Session initialized" --timeout 30

# Create session for bob
openclaw agent --session-id "agent:main:bob" --message "Session initialized" --timeout 30
```

Verify the session was created:

```bash
grep -A 2 '"agent:main:alice"' ~/.openclaw/agents/main/sessions/sessions.json
```

Expected output:

```json
"agent:main:alice": {
  "sessionId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  ...
}
```

### 4. Start the Server

```bash
npm start
```

### 5. Configure Webhook

1. Start ngrok:
   
   ```bash
   ngrok http 8789
   ```

2. Copy the HTTPS URL (e.g., `https://abc123.ngrok-free.app`)

3. Set webhook in AgentMail dashboard:
   
   ```
   https://abc123.ngrok-free.app
   ```

## How It Works

### Email to Session Flow

1. **Receive**: AgentMail webhook delivers incoming email
2. **Identify**: Extract email address, lookup `userId` in `identityLinks`
3. **Resolve**: Query `sessions.json` to get the session UUID
4. **Process**: Forward message to OpenClaw session `agent:main:{userId}`
5. **Reply**: Agent response sent back via Resend

### Session Resolution

The key insight: OpenClaw stores sessions by UUID, but we identify them by `agent:main:{userId}`. Mail Channel bridges this by:

- `identityLinks`: email → userId
- `sessions.json`: userId → UUID
- CLI: UUID → actual session file

This ensures web UI and email share the same conversation history.

## Troubleshooting

### "Session xxx does not exist"

The session hasn't been created yet. Run:

```bash
openclaw agent --session-id "agent:main:USERNAME" --message "hi" --timeout 30
```

### Port 8789 already in use

```bash
lsof -i :8789 | grep LISTEN | awk '{print $2}' | xargs kill -9
```

### Emails not sending

- Verify Resend API key is correct
- Ensure domain is verified in Resend dashboard
- Check Resend dashboard for delivery logs

## Project Structure

```
mail-channel/
├── config.json              # API keys (gitignored)
├── config.example.json      # Example configuration
├── resend-client.js         # Resend API client
├── server.js                # Main server + webhook handler
├── package.json             # Dependencies
└── README.md                # This file

~/.openclaw/
├── openclaw.json            # identityLinks configuration
└── agents/main/sessions/
    ├── sessions.json        # session key → UUID mapping
    └── {uuid}.jsonl         # Conversation history
```

## Requirements

- [OpenClaw](https://github.com/openclaw/openclaw) installed and running
- [AgentMail](https://agentmail.to) account for inbound email
- [Resend](https://resend.com) account for outbound email
- ngrok (or similar) for webhook tunneling

## License

MIT
