# Quick Start Guide

Get the CTI Middleware up and running in 10 minutes!

## Prerequisites Check

```bash
# Check Node.js version (need 18+)
node -v

# Check npm
npm -v

# Check Docker (optional)
docker --version
docker-compose --version
```

## Option 1: Local Setup (Recommended for Development)

### Step 1: Install Dependencies

```bash
# Run automated setup script
bash setup.sh

# OR manually:
npm install
```

### Step 2: Configure Environment

```bash
# Copy template and edit
cp env.template .env
nano .env
```

**Minimum required configuration:**

```env
# FreePBX AMI
AMI_HOST=192.168.1.100
AMI_USERNAME=admin
AMI_SECRET=your_ami_password

# SuiteCRM
SUITECRM_URL=https://crm.yourcompany.com
SUITECRM_CLIENT_ID=abc123
SUITECRM_CLIENT_SECRET=xyz789
SUITECRM_USERNAME=admin
SUITECRM_PASSWORD=your_crm_password

# Security
API_KEY=$(openssl rand -hex 32)
```

### Step 3: Start Server

```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm start
```

### Step 4: Verify

```bash
# Check health
curl http://localhost:3000/health

# Expected response:
# {"status":"ok","timestamp":"...","uptime":5.123}
```

## Option 2: Docker Setup (Recommended for Production)

### Step 1: Configure Environment

```bash
cp env.template .env
nano .env
```

### Step 2: Start with Docker Compose

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f cti-middleware

# Check status
docker-compose ps
```

### Step 3: Verify

```bash
curl http://localhost:3000/health
```

## Testing the Integration

### Test 1: WebSocket Connection

Open `example-client.html` in your browser:

```bash
# If you have Python installed:
python -m http.server 8000

# Then open: http://localhost:8000/example-client.html
```

Or simply open the file directly in your browser.

**In the client:**
1. Enter Agent ID: `123`
2. Enter Agent Name: `Your Name`
3. Enter Extension: `1001`
4. Click "Connect"
5. You should see "✓ Connected to WebSocket server"

### Test 2: Make a Test Call

1. Call your FreePBX number
2. Watch the example client for screen pop
3. Check logs: `tail -f logs/combined-*.log`
4. Check SuiteCRM for created call record

### Test 3: Webhook (if using ElevenLabs)

```bash
# Send test webhook
curl -X POST http://localhost:3000/webhook/elevenlabs \
  -H "Content-Type: application/json" \
  -H "elevenlabs-signature: t=1234567890,v0=test" \
  -d '{
    "type": "post_call_transcription",
    "event_timestamp": 1234567890,
    "data": {
      "agent_id": "test",
      "conversation_id": "test-123",
      "status": "done"
    }
  }'
```

## Common Issues & Solutions

### Issue: "AMI Connection Failed"

**Solution:**

```bash
# Test AMI connectivity
telnet your-freepbx-ip 5038

# If connection refused, check FreePBX firewall:
# FreePBX > Admin > Firewall > Add service > AMI
# Add your middleware server IP
```

### Issue: "SuiteCRM Authentication Failed"

**Solution:**

```bash
# Verify OAuth2 keys exist
ssh your-crm-server
cd /var/www/html/suitecrm/Api/V8/OAuth2
ls -la *.key

# If missing, generate:
openssl genrsa -out private.key 2048
openssl rsa -in private.key -pubout -out public.key
chmod 600 *.key
chown www-data:www-data *.key
```

### Issue: "Cannot connect to WebSocket"

**Solution:**

```bash
# Check if server is running
curl http://localhost:3000/health

# Check firewall
sudo ufw status
sudo ufw allow 3000/tcp

# Check logs
tail -f logs/combined-*.log
```

### Issue: "Webhook signature verification failed"

**Solution:**

```bash
# For development, disable verification:
# In .env:
ELEVENLABS_WEBHOOK_SECRET=

# For production, verify secret matches ElevenLabs dashboard
```

## Next Steps

### 1. Production Deployment

- [ ] Set up HTTPS with Let's Encrypt
- [ ] Configure reverse proxy (nginx/Apache)
- [ ] Set up monitoring (PM2, Prometheus)
- [ ] Configure automated backups
- [ ] Review SECURITY.md

### 2. Customize for Your Workflow

- [ ] Add custom fields in SuiteCRM
- [ ] Configure call routing rules
- [ ] Set up email notifications
- [ ] Customize screen pop UI
- [ ] Add business logic

### 3. Scale Your Deployment

- [ ] Set up load balancer
- [ ] Implement Redis for session storage
- [ ] Configure multi-instance deployment
- [ ] Set up database for call history
- [ ] Implement CDN for static assets

## Getting Help

### Check Logs

```bash
# Combined logs
tail -f logs/combined-*.log

# Errors only
tail -f logs/error-*.log

# With grep
tail -f logs/combined-*.log | grep "ERROR\|WARN"
```

### Debug Mode

```bash
# Enable debug logging
LOG_LEVEL=debug npm start

# Or in .env:
LOG_LEVEL=debug
```

### Test Each Component

```bash
# Test FreePBX AMI
npm run test:ami    # (if test script exists)

# Test SuiteCRM API
npm run test:crm    # (if test script exists)

# Check all active calls
curl -H "x-api-key: your_key" http://localhost:3000/api/calls/active

# Check connected agents
curl -H "x-api-key: your_key" http://localhost:3000/api/agents
```

## Useful Commands

```bash
# View all processes
ps aux | grep node

# Stop server
pkill -f "node.*index.js"

# Restart Docker container
docker-compose restart cti-middleware

# View Docker logs (last 100 lines)
docker-compose logs --tail=100 cti-middleware

# Enter Docker container
docker-compose exec cti-middleware sh

# Clean up old logs
find logs/ -name "*.log" -mtime +14 -delete

# Check disk space
df -h

# Monitor resource usage
htop
```

## API Quick Reference

### Get Status

```bash
curl -H "x-api-key: YOUR_KEY" http://localhost:3000/api/status
```

### Get Active Calls

```bash
curl -H "x-api-key: YOUR_KEY" http://localhost:3000/api/calls/active
```

### Get Connected Agents

```bash
curl -H "x-api-key: YOUR_KEY" http://localhost:3000/api/agents
```

### Manual Screen Pop

```bash
curl -X POST http://localhost:3000/api/screen-pop \
  -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agentIdentifier": "1001",
    "callData": {
      "callerIdNum": "+1234567890",
      "callerIdName": "John Doe"
    }
  }'
```

## Performance Tips

1. **Optimize Log Level:**
   - Development: `debug`
   - Production: `info` or `warn`

2. **Monitor Memory:**
   ```bash
   # Check memory usage
   docker stats cti-middleware
   ```

3. **Database Optimization:**
   - Index phone number fields in SuiteCRM
   - Clean old call records regularly
   - Optimize CRM database

4. **Network Optimization:**
   - Place middleware close to FreePBX
   - Use internal network for AMI
   - Enable keep-alive for HTTP connections

## Success Checklist

- [ ] Server starts without errors
- [ ] Health endpoint returns 200
- [ ] FreePBX AMI connects successfully
- [ ] SuiteCRM authentication works
- [ ] WebSocket client connects
- [ ] Test call creates CRM record
- [ ] Screen pop displays on incoming call
- [ ] Webhook receives events (if configured)
- [ ] Logs are being written
- [ ] All security measures in place

---

**Congratulations! You're ready to handle calls like a pro! 🎉**

For detailed documentation, see [README.md](README.md)

For security guidelines, see [SECURITY.md](SECURITY.md)

