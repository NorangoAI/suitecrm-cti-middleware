# CTI Middleware

A comprehensive Computer Telephony Integration (CTI) middleware that connects FreePBX/Asterisk, ElevenLabs AI Voice Agent, and SuiteCRM for seamless call handling, real-time screen pops, and AI-powered call analytics.

## 🚀 Features

- **FreePBX/Asterisk Integration** - Real-time call events via AMI (Asterisk Manager Interface)
- **ElevenLabs AI Agent Webhook** - Receive post-call transcriptions and AI analysis
- **SuiteCRM Integration** - Automatic call logging with OAuth2 authentication
- **Real-time Screen Pop** - WebSocket-based agent notifications with caller context
- **Contact/Account Lookup** - Automatic caller identification from CRM
- **AI-Powered Analytics** - Call transcriptions, summaries, and success metrics
- **Comprehensive Logging** - Rotating file logs with Winston
- **Security Features** - HMAC signature verification, API key authentication, rate limiting
- **Docker Support** - Easy deployment with Docker Compose

## 📋 Prerequisites

- Node.js 18+ and npm
- FreePBX/Asterisk server with AMI enabled
- SuiteCRM instance with API V8 configured
- ElevenLabs account with webhook access (optional)

## 🛠️ Installation

### Standard Installation

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd cti-middleware
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   
   Create a `.env` file in the project root:
   ```bash
   # Server Configuration
   NODE_ENV=production
   PORT=3000
   WS_PORT=3001

   # FreePBX/Asterisk AMI Configuration
   AMI_HOST=your-freepbx-server.com
   AMI_PORT=5038
   AMI_USERNAME=admin
   AMI_SECRET=your_ami_secret

   # ElevenLabs Webhook Configuration
   ELEVENLABS_WEBHOOK_SECRET=your_elevenlabs_webhook_secret

   # SuiteCRM API Configuration
   SUITECRM_URL=https://your-suitecrm.com
   SUITECRM_CLIENT_ID=your_client_id
   SUITECRM_CLIENT_SECRET=your_client_secret
   SUITECRM_USERNAME=admin
   SUITECRM_PASSWORD=your_password

   # Security Configuration
   API_KEY=your_secure_api_key
   ALLOWED_ORIGINS=http://localhost:3000,https://your-domain.com

   # Logging Configuration
   LOG_LEVEL=info
   LOG_DIR=./logs
   ```

4. **Configure settings (optional):**
   
   Edit `config.json` to customize additional settings like retry logic, timeouts, and WebSocket options.

5. **Start the server:**
   ```bash
   npm start
   ```

### Docker Installation

1. **Create `.env` file** with the same variables as above

2. **Build and start with Docker Compose:**
   ```bash
   docker-compose up -d
   ```

3. **View logs:**
   ```bash
   docker-compose logs -f cti-middleware
   ```

## 🔧 Configuration

### FreePBX AMI Setup

1. Enable AMI in FreePBX:
   - Go to Settings > Asterisk Manager Users
   - Create a new user with read/write permissions
   - Allow connections from the middleware server IP

2. Edit `/etc/asterisk/manager.conf`:
   ```ini
   [general]
   enabled = yes
   port = 5038
   bindaddr = 0.0.0.0

   [admin]
   secret = your_ami_secret
   deny=0.0.0.0/0.0.0.0
   permit=your-middleware-ip/255.255.255.255
   read = all
   write = all
   ```

### SuiteCRM API Setup

1. **Generate OAuth2 Keys:**
   ```bash
   cd /path/to/suitecrm/Api/V8/OAuth2
   openssl genrsa -out private.key 2048
   openssl rsa -in private.key -pubout -out public.key
   sudo chmod 600 private.key public.key
   sudo chown www-data:www-data *.key
   ```

2. **Create OAuth2 Client:**
   - Go to Admin > OAuth2 Clients
   - Create new client
   - Copy Client ID and Secret to your `.env` file

3. **Enable API:**
   - Ensure mod_rewrite is enabled in Apache
   - Set `AllowOverride All` in Apache config for SuiteCRM directory

### ElevenLabs Webhook Setup

1. **Get your webhook secret** from ElevenLabs dashboard

2. **Configure webhook URL:**
   ```
   https://your-server.com/webhook/elevenlabs
   ```

3. **Select events:**
   - Enable "post_call_transcription" event

## 📡 API Endpoints

### Health & Status

- `GET /health` - Health check endpoint
- `GET /api/status` - Get middleware statistics (requires API key)

### Call Management

- `GET /api/calls/active` - Get all active calls (requires API key)
- `POST /api/screen-pop` - Manually trigger screen pop (requires API key)

### Agent Management

- `GET /api/agents` - Get connected agents (requires API key)

### Webhooks

- `POST /webhook/elevenlabs` - ElevenLabs webhook endpoint (HMAC verified)

## 🔌 WebSocket Client Integration

Connect to the WebSocket server to receive real-time call events:

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

ws.onopen = () => {
  // Register agent
  ws.send(JSON.stringify({
    type: 'register_agent',
    agentId: '123',
    agentName: 'John Doe',
    extension: '1001'
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch(data.type) {
    case 'screen_pop':
      // Display caller information
      console.log('Incoming call:', data.callData);
      break;
      
    case 'call_update':
      // Update call status
      console.log('Call update:', data.callData);
      break;
      
    case 'ai_transcription':
      // Show AI summary
      console.log('AI Summary:', data.summary);
      break;
  }
};
```

## 📊 Call Flow

### End-to-End Flow Example

1. **Incoming Call to FreePBX**
   - FreePBX receives call from `+1234567890`
   - AMI emits `NewChannel` event
   - Middleware captures call details

2. **Contact Lookup & Screen Pop**
   - Middleware searches SuiteCRM for contact by phone number
   - Contact found: "John Smith" with account "Acme Corp"
   - Screen pop sent to agent extension via WebSocket
   - Agent sees caller info before answering

3. **Call Connected**
   - AMI emits `Bridge` event
   - Middleware tracks call connection
   - Real-time updates sent to WebSocket clients

4. **Call Ends**
   - AMI emits `Hangup` event
   - Call record created in SuiteCRM
   - Call linked to contact and account
   - Duration: 5 minutes, Cause: Normal Clearing

5. **AI Analysis (Optional)**
   - ElevenLabs webhook arrives with transcription
   - AI summary: "Customer inquired about pricing"
   - Call success: "success"
   - SuiteCRM call record updated with AI data
   - Transcript and summary stored

## 🔐 Security Best Practices

1. **Use Strong Secrets:**
   - Generate secure API keys: `openssl rand -hex 32`
   - Use different keys for each environment

2. **Enable HTTPS:**
   - Always use HTTPS in production
   - Configure SSL/TLS certificates
   - Use reverse proxy (nginx, Apache)

3. **Firewall Configuration:**
   - Restrict AMI access to middleware IP only
   - Limit webhook endpoints to trusted IPs
   - Use VPN for sensitive connections

4. **Environment Variables:**
   - Never commit `.env` files
   - Use secrets management in production
   - Rotate credentials regularly

5. **Rate Limiting:**
   - Configure appropriate rate limits
   - Monitor for suspicious activity
   - Use fail2ban for repeated failures

6. **Webhook Security:**
   - Always verify HMAC signatures
   - Validate timestamp to prevent replay attacks
   - Use webhook secrets

## 📝 Logging

Logs are stored in the `./logs` directory with daily rotation:

- `combined-YYYY-MM-DD.log` - All logs
- `error-YYYY-MM-DD.log` - Errors only

Log levels: `error`, `warn`, `info`, `debug`, `verbose`

Configure log level in `.env`:
```bash
LOG_LEVEL=debug  # For development
LOG_LEVEL=info   # For production
```

## 🐛 Troubleshooting

### AMI Connection Issues

```bash
# Test AMI connection
telnet your-freepbx-server 5038

# Check AMI credentials
# Verify in FreePBX: Settings > Asterisk Manager Users
```

### SuiteCRM Authentication Fails

```bash
# Verify OAuth2 keys exist
ls -la /path/to/suitecrm/Api/V8/OAuth2/

# Check permissions
chmod 600 private.key public.key
chown www-data:www-data *.key

# Test API manually
curl -X POST https://your-suitecrm.com/Api/access_token \
  -d "grant_type=password" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "username=admin" \
  -d "password=YOUR_PASSWORD"
```

### WebSocket Not Connecting

```bash
# Check if WebSocket server is running
curl http://localhost:3000/health

# Check firewall rules
sudo ufw status

# Test WebSocket connection
wscat -c ws://localhost:3000/ws
```

### Webhook Not Receiving Events

```bash
# Check webhook logs
tail -f logs/combined-*.log | grep webhook

# Test webhook endpoint
curl -X POST http://localhost:3000/webhook/elevenlabs \
  -H "Content-Type: application/json" \
  -d '{"test": true}'

# Verify ElevenLabs webhook configuration
# Check webhook URL and secret in ElevenLabs dashboard
```

## 🧪 Testing

### Manual Testing

1. **Test Health Endpoint:**
   ```bash
   curl http://localhost:3000/health
   ```

2. **Test Status Endpoint:**
   ```bash
   curl -H "x-api-key: your_api_key" http://localhost:3000/api/status
   ```

3. **Test WebSocket:**
   ```bash
   npm install -g wscat
   wscat -c ws://localhost:3000/ws
   ```

4. **Make Test Call:**
   - Call your FreePBX number
   - Check logs for call events
   - Verify screen pop in WebSocket client
   - Check SuiteCRM for call record

## 📦 Project Structure

```
cti-middleware/
├── src/
│   ├── index.js                 # Main application entry point
│   ├── middleware/
│   │   └── CTIMiddleware.js     # Core orchestration logic
│   ├── services/
│   │   ├── FreePBXClient.js     # AMI client for FreePBX
│   │   ├── ElevenLabsWebhook.js # Webhook handler for ElevenLabs
│   │   ├── SuiteCRMClient.js    # REST API client for SuiteCRM
│   │   └── WebSocketServer.js   # WebSocket server for agents
│   └── utils/
│       ├── config.js             # Configuration loader
│       └── logger.js             # Logging utility
├── logs/                         # Log files (auto-generated)
├── config.json                   # Application configuration
├── package.json                  # Dependencies
├── Dockerfile                    # Docker configuration
├── docker-compose.yml            # Docker Compose setup
└── README.md                     # This file
```

## 🔄 Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | Environment mode |
| `PORT` | No | `3000` | HTTP server port |
| `WS_PORT` | No | `3001` | WebSocket port (deprecated, uses same as PORT) |
| `AMI_HOST` | Yes | - | FreePBX/Asterisk host |
| `AMI_PORT` | No | `5038` | AMI port |
| `AMI_USERNAME` | Yes | - | AMI username |
| `AMI_SECRET` | Yes | - | AMI password |
| `ELEVENLABS_WEBHOOK_SECRET` | No | - | Webhook HMAC secret |
| `SUITECRM_URL` | Yes | - | SuiteCRM base URL |
| `SUITECRM_CLIENT_ID` | Yes | - | OAuth2 client ID |
| `SUITECRM_CLIENT_SECRET` | Yes | - | OAuth2 client secret |
| `SUITECRM_USERNAME` | Yes | - | SuiteCRM username |
| `SUITECRM_PASSWORD` | Yes | - | SuiteCRM password |
| `API_KEY` | No | - | API key for protected endpoints |
| `ALLOWED_ORIGINS` | No | `[]` | CORS allowed origins (comma-separated) |
| `LOG_LEVEL` | No | `info` | Logging level |
| `LOG_DIR` | No | `./logs` | Log directory path |

## 📄 License

MIT License - See LICENSE file for details

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📞 Support

For issues and questions:
- Open an issue on GitHub
- Check existing issues for solutions
- Review logs in `./logs` directory

## 🎯 Roadmap

- [ ] Add support for outbound call origination
- [ ] Implement call recording integration
- [ ] Add support for multiple CRM systems
- [ ] Create web-based admin dashboard
- [ ] Add support for SMS/MMS integration
- [ ] Implement call queue monitoring
- [ ] Add Prometheus metrics export
- [ ] Create browser extension for screen pop

## ⚡ Performance Tips

1. **Optimize Log Levels:**
   - Use `info` or `warn` in production
   - Reserve `debug` for development

2. **Database Connections:**
   - Configure appropriate connection pooling in SuiteCRM
   - Monitor CRM API response times

3. **WebSocket Scaling:**
   - Use Redis pub/sub for multi-instance deployment
   - Configure load balancer for WebSocket sticky sessions

4. **Memory Management:**
   - Cleanup old calls runs every 10 minutes
   - Monitor memory usage with `process.memoryUsage()`

---

**Built with ❤️ for better customer interactions**
