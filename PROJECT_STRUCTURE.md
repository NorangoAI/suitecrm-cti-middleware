# Project Structure

## Overview

```
cti-middleware/
│
├── src/                          # Source code
│   ├── index.js                  # Main application entry point
│   ├── middleware/               # Core business logic
│   │   └── CTIMiddleware.js      # Orchestrates all services
│   ├── services/                 # External service integrations
│   │   ├── FreePBXClient.js      # Asterisk AMI client
│   │   ├── ElevenLabsWebhook.js  # AI webhook handler
│   │   ├── SuiteCRMClient.js     # CRM API client
│   │   └── WebSocketServer.js    # Real-time agent communication
│   └── utils/                    # Utility modules
│       ├── config.js             # Configuration management
│       └── logger.js             # Logging system
│
├── logs/                         # Application logs (auto-generated)
│   ├── combined-YYYY-MM-DD.log   # All logs
│   └── error-YYYY-MM-DD.log      # Error logs only
│
├── config.json                   # Application configuration
├── package.json                  # NPM dependencies and scripts
├── .gitignore                    # Git ignore rules
├── .npmignore                    # NPM publish ignore rules
├── .dockerignore                 # Docker build ignore rules
│
├── env.template                  # Environment variables template
├── setup.sh                      # Automated setup script
│
├── Dockerfile                    # Docker container definition
├── docker-compose.yml            # Docker Compose configuration
│
├── example-client.html           # WebSocket client demo
│
├── README.md                     # Main documentation
├── QUICKSTART.md                 # Quick start guide
├── SECURITY.md                   # Security best practices
├── CHANGELOG.md                  # Version history
├── LICENSE                       # MIT License
└── PROJECT_STRUCTURE.md          # This file
```

## Core Components

### 1. Main Application (`src/index.js`)

**Purpose:** Application entry point and HTTP server

**Key Features:**
- Express.js server setup
- Security middleware (helmet, CORS, rate limiting)
- API route definitions
- WebSocket initialization
- Graceful shutdown handling
- Error handling middleware

**Endpoints:**
- `GET /health` - Health check
- `GET /api/status` - Server statistics
- `GET /api/calls/active` - Active calls list
- `GET /api/agents` - Connected agents
- `POST /api/screen-pop` - Manual screen pop
- `POST /webhook/elevenlabs` - ElevenLabs webhook

### 2. CTI Middleware (`src/middleware/CTIMiddleware.js`)

**Purpose:** Core orchestration layer connecting all services

**Responsibilities:**
- Event coordination between services
- Call state management
- Contact/Account lookup
- CRM record creation
- Screen pop distribution
- AI data integration

**Event Flow:**
```
FreePBX Event → CTIMiddleware → [
  ├─→ CRM Lookup
  ├─→ Create Call Record
  └─→ Send Screen Pop
]

AI Webhook → CTIMiddleware → [
  ├─→ Update CRM Record
  └─→ Broadcast to Agents
]
```

### 3. FreePBX Client (`src/services/FreePBXClient.js`)

**Purpose:** Asterisk Manager Interface (AMI) integration

**Key Features:**
- AMI connection management
- Automatic reconnection
- Call event monitoring
- Channel tracking
- Call origination support

**Events Handled:**
- `NewChannel` - New call initiated
- `NewState` - Channel state changed
- `Dial` - Outgoing call
- `Hangup` - Call ended
- `Bridge` - Calls connected

### 4. ElevenLabs Webhook (`src/services/ElevenLabsWebhook.js`)

**Purpose:** AI voice agent webhook receiver

**Key Features:**
- HMAC signature verification
- Timestamp validation (replay attack prevention)
- Webhook event routing
- Express router integration

**Event Types:**
- `post_call_transcription` - Call completed with AI analysis
- `voice_removal_notice` - Voice scheduled for removal
- `voice_removal_notice_withdrawn` - Removal cancelled
- `voice_removed` - Voice deleted

### 5. SuiteCRM Client (`src/services/SuiteCRMClient.js`)

**Purpose:** CRM API integration with OAuth2

**Key Features:**
- OAuth2 password grant authentication
- Automatic token refresh
- Retry mechanism
- Call record CRUD operations
- Contact/Account search
- Relationship management

**Operations:**
- `createCall()` - Create call record
- `updateCall()` - Update existing call
- `searchContactByPhone()` - Find contact
- `searchAccountByPhone()` - Find account
- `linkCallToContact()` - Create relationship
- `linkCallToAccount()` - Create relationship

### 6. WebSocket Server (`src/services/WebSocketServer.js`)

**Purpose:** Real-time communication with agent clients

**Key Features:**
- Connection management
- Agent registration
- Screen pop delivery
- Ping/pong keep-alive
- Broadcast capabilities

**Message Types:**
- `screen_pop` - Incoming call notification
- `call_update` - Call status change
- `ai_transcription` - AI summary available
- `connected` - Connection acknowledged
- `registered` - Agent registered

### 7. Configuration (`src/utils/config.js`)

**Purpose:** Centralized configuration management

**Sources:**
1. `config.json` - Base configuration
2. Environment variables - Override config.json
3. Validation - Ensure required fields

**Structure:**
```javascript
{
  server: { port, wsPort, environment },
  freepbx: { ami: { host, port, username, secret } },
  elevenlabs: { webhookSecret, webhookPath },
  suitecrm: { baseUrl, clientId, clientSecret },
  websocket: { pingInterval, maxConnections },
  logging: { level, directory, maxFiles, maxSize },
  security: { apiKey, allowedOrigins, rateLimit }
}
```

### 8. Logger (`src/utils/logger.js`)

**Purpose:** Comprehensive logging system

**Features:**
- Console and file logging
- Daily log rotation
- Multiple log levels
- Structured metadata
- Separate error logs

**Log Methods:**
- `info()` - General information
- `warn()` - Warning messages
- `error()` - Error with stack trace
- `debug()` - Debug information
- `logAMIEvent()` - AMI events
- `logWebhook()` - Webhook events
- `logAPICall()` - API calls
- `logWSEvent()` - WebSocket events

## Data Flow

### Incoming Call Flow

```
┌─────────────┐
│  FreePBX    │
│  Receives   │
│    Call     │
└──────┬──────┘
       │
       │ AMI Event: NewChannel
       ↓
┌─────────────────────────┐
│   FreePBXClient         │
│   - Parse call data     │
│   - Store channel info  │
└──────┬──────────────────┘
       │
       │ Emit: call:new
       ↓
┌─────────────────────────┐
│   CTIMiddleware         │
│   - Lookup contact      │ ←──┐
│   - Lookup account      │    │
│   - Store call data     │    │
└──────┬─────────┬────────┘    │
       │         │              │
       │         │ API Call     │
       │         ↓              │
       │    ┌────────────┐     │
       │    │ SuiteCRM   │     │
       │    │  Client    │─────┘
       │    └────────────┘
       │
       │ Screen Pop Data
       ↓
┌─────────────────────────┐
│   WebSocketServer       │
│   - Find agent          │
│   - Send screen pop     │
└──────┬──────────────────┘
       │
       │ WebSocket Message
       ↓
┌─────────────────────────┐
│   Agent Browser         │
│   - Display caller info │
│   - Show contact        │
└─────────────────────────┘
```

### Call Hangup Flow

```
┌─────────────┐
│  FreePBX    │
│  Call Ends  │
└──────┬──────┘
       │
       │ AMI Event: Hangup
       ↓
┌─────────────────────────┐
│   FreePBXClient         │
│   - Calculate duration  │
│   - Get hangup cause    │
└──────┬──────────────────┘
       │
       │ Emit: call:hangup
       ↓
┌─────────────────────────┐
│   CTIMiddleware         │
│   - Prepare call data   │
└──────┬──────────────────┘
       │
       │ Create call record
       ↓
┌─────────────────────────┐
│   SuiteCRMClient        │
│   - Create call         │
│   - Link to contact     │
│   - Link to account     │
└─────────────────────────┘
```

### AI Webhook Flow

```
┌─────────────┐
│ ElevenLabs  │
│  Webhook    │
└──────┬──────┘
       │
       │ POST /webhook/elevenlabs
       ↓
┌─────────────────────────┐
│  ElevenLabsWebhook      │
│  - Verify signature     │
│  - Check timestamp      │
│  - Parse event          │
└──────┬──────────────────┘
       │
       │ Event: post_call_transcription
       ↓
┌─────────────────────────┐
│   CTIMiddleware         │
│   - Find matching call  │
│   - Extract AI data     │
└──────┬──────────────────┘
       │
       │ Update call record
       ↓
┌─────────────────────────┐
│   SuiteCRMClient        │
│   - Add transcript      │
│   - Add summary         │
│   - Add success metric  │
└─────────────────────────┘
```

## Configuration Files

### package.json
- Node.js dependencies
- npm scripts
- Project metadata

### config.json
- Default application settings
- Can be overridden by environment variables

### env.template
- Template for .env file
- Documents all configuration options

### docker-compose.yml
- Multi-container Docker setup
- Service definitions
- Network configuration
- Volume mappings

### Dockerfile
- Container build instructions
- Node.js base image
- Security settings (non-root user)
- Health check definition

## Documentation Files

### README.md
- Main project documentation
- Installation instructions
- Configuration guide
- API reference
- Troubleshooting

### QUICKSTART.md
- Fast setup guide
- Testing instructions
- Common issues
- Quick commands

### SECURITY.md
- Security best practices
- Network configuration
- Authentication setup
- Compliance guidelines

### CHANGELOG.md
- Version history
- Feature additions
- Bug fixes
- Breaking changes

## Helper Files

### setup.sh
- Automated setup script
- Dependency installation
- .env file creation
- Directory initialization

### example-client.html
- WebSocket client demo
- Screen pop visualization
- Agent registration example
- Event logging display

## Development Workflow

### Local Development

1. **Setup:**
   ```bash
   npm install
   cp env.template .env
   nano .env
   ```

2. **Run:**
   ```bash
   npm run dev  # Auto-reload on changes
   ```

3. **Test:**
   ```bash
   curl http://localhost:3000/health
   ```

### Docker Development

1. **Build:**
   ```bash
   docker-compose build
   ```

2. **Run:**
   ```bash
   docker-compose up
   ```

3. **Debug:**
   ```bash
   docker-compose logs -f cti-middleware
   ```

## Testing Strategy

### Manual Testing

1. **Component Tests:**
   - Health endpoint
   - AMI connection
   - CRM authentication
   - WebSocket connection

2. **Integration Tests:**
   - Make test call
   - Verify screen pop
   - Check CRM record
   - Test AI webhook

3. **End-to-End Tests:**
   - Complete call flow
   - Multiple simultaneous calls
   - Agent disconnection/reconnection

### Automated Testing (Future)

```
tests/
├── unit/
│   ├── config.test.js
│   ├── logger.test.js
│   └── services/
├── integration/
│   ├── ami.test.js
│   ├── crm.test.js
│   └── webhook.test.js
└── e2e/
    └── call-flow.test.js
```

## Deployment Considerations

### Production Checklist

- [ ] HTTPS configured
- [ ] Environment variables set
- [ ] Firewall rules applied
- [ ] Monitoring enabled
- [ ] Backups configured
- [ ] Logs rotated
- [ ] Rate limits tuned
- [ ] Security audit completed

### Scaling Options

1. **Vertical Scaling:**
   - Increase CPU/RAM
   - Optimize log level
   - Database tuning

2. **Horizontal Scaling:**
   - Load balancer
   - Redis for shared state
   - Database for call history
   - Message queue for webhooks

## Monitoring Points

### Key Metrics

- Active connections
- Calls per minute
- CRM response time
- WebSocket latency
- Error rate
- Memory usage
- CPU usage

### Log Patterns to Watch

- `ERROR` - Application errors
- `AMI Event` - Call events
- `API Call` - External API calls
- `WebSocket` - Agent connections
- `Webhook` - Incoming webhooks

## Maintenance Tasks

### Daily
- Check error logs
- Monitor active calls
- Verify agent connections

### Weekly
- Review security logs
- Check disk space
- Update dependencies

### Monthly
- Rotate credentials
- Archive old logs
- Performance review

### Quarterly
- Security audit
- Dependency updates
- Feature review

---

**This structure is designed for:**
- Easy navigation
- Clear separation of concerns
- Scalability
- Maintainability
- Security
- Monitoring
- Documentation

