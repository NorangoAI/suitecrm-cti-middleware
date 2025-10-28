const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const http = require('http');

// Import utilities
const config = require('./utils/config');
const Logger = require('./utils/logger');

// Import services
const FreePBXClient = require('./services/FreePBXClient');
const ElevenLabsWebhook = require('./services/ElevenLabsWebhook');
const SuiteCRMClient = require('./services/SuiteCRMClient');
const WebSocketServer = require('./services/WebSocketServer');

// Import middleware
const CTIMiddleware = require('./middleware/CTIMiddleware');

// Initialize logger
const logger = new Logger(config.get('logging'));

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: config.get('security.allowedOrigins'),
  credentials: true
}));

// Trust proxy - required for rate limiting and getting correct client IP
app.set('trust proxy', true);

// API prefix from configuration
const API_PREFIX = config.get('server.apiPrefix') || '/cti-middleware';

// Rate limiting
const limiter = rateLimit({
  windowMs: config.get('security.rateLimitWindowMs'),
  max: config.get('security.rateLimitMaxRequests'),
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    trustProxy: false, // Skip trust proxy validation for webhook endpoints
    xForwardedForHeader: false
  }
});

// Body parser for JSON (except webhook routes which use raw body)
// Increase limit to 50mb to handle large payloads
app.use((req, res, next) => {
  if (req.path.includes('/webhook/')) {
    next();
  } else {
    express.json({ limit: '50mb' })(req, res, next);
  }
});

// API Key validation middleware
const validateApiKey = (req, res, next) => {
  if (!config.get('security.requireApiKey')) {
    return next();
  }

  const apiKey = req.headers['x-api-key'];

  if (!apiKey || apiKey !== config.get('security.apiKey')) {
    logger.warn('Invalid API key attempt', {
      ip: req.ip,
      path: req.path
    });
    return res.status(401).json({ error: 'Invalid API key' });
  }

  next();
};

// Create API router
const apiRouter = express.Router();

// Apply rate limiting to webhook routes
apiRouter.use('/webhook', limiter);

// Apply API key validation to protected routes
apiRouter.use('/api', validateApiKey);

// Health check endpoint
apiRouter.get('/health', (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.get('server.environment'),
    services: {
      freepbx: freepbxClient.isConnected(),
      websocket: wsServer.getConnectionsCount() >= 0,
      suitecrm: 'unknown' // Will be determined by test connection
    }
  };

  res.json(health);
});

// Status endpoint with stats
apiRouter.get('/api/status', (req, res) => {
  try {
    const stats = ctiMiddleware.getStats();
    res.json({
      status: 'ok',
      ...stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error getting status', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// Get active calls
apiRouter.get('/api/calls/active', (req, res) => {
  try {
    const calls = ctiMiddleware.getAllActiveCalls();
    res.json({
      count: calls.length,
      calls
    });
  } catch (error) {
    logger.error('Error getting active calls', error);
    res.status(500).json({ error: 'Failed to get active calls' });
  }
});

// Get connected agents
apiRouter.get('/api/agents', (req, res) => {
  try {
    const agents = wsServer.getConnectedAgents();
    res.json({
      count: agents.length,
      agents
    });
  } catch (error) {
    logger.error('Error getting connected agents', error);
    res.status(500).json({ error: 'Failed to get agents' });
  }
});

// Manual screen pop endpoint
apiRouter.post('/api/screen-pop', (req, res) => {
  try {
    const { agentIdentifier, callData } = req.body;

    if (!agentIdentifier || !callData) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const sent = wsServer.sendScreenPop(agentIdentifier, callData);

    res.json({
      success: sent,
      message: sent ? 'Screen pop sent' : 'Agent not found or not connected'
    });
  } catch (error) {
    logger.error('Error sending screen pop', error);
    res.status(500).json({ error: 'Failed to send screen pop' });
  }
});

// ====================================
// SuiteCRM Test Endpoints
// ====================================

// Test SuiteCRM authentication
apiRouter.get('/api/test/crm/auth', async (req, res) => {
  try {
    const result = await suitecrmClient.testConnection();
    res.json({
      success: result,
      message: result ? 'SuiteCRM authentication successful' : 'SuiteCRM authentication failed',
      authenticated: suitecrmClient.accessToken !== null,
      tokenExpiry: suitecrmClient.tokenExpiry ? new Date(suitecrmClient.tokenExpiry).toISOString() : null
    });
  } catch (error) {
    logger.error('SuiteCRM auth test failed', error);
    res.status(500).json({
      success: false,
      error: error.message,
      hint: 'Check SUITECRM_URL, SUITECRM_CLIENT_ID, SUITECRM_CLIENT_SECRET in .env'
    });
  }
});

// Test search contact by phone
apiRouter.get('/api/test/crm/contact/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    const result = await suitecrmClient.searchContactByPhone(phone);

    res.json({
      success: result.success,
      found: result.found,
      count: result.data.length,
      contacts: result.data.map(contact => ({
        id: contact.id,
        name: `${contact.attributes.first_name} ${contact.attributes.last_name}`,
        phone: contact.attributes.phone_mobile || contact.attributes.phone_work,
        email: contact.attributes.email1
      }))
    });
  } catch (error) {
    logger.error('Contact search test failed', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test search account by phone
apiRouter.get('/api/test/crm/account/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    const result = await suitecrmClient.searchAccountByPhone(phone);

    res.json({
      success: result.success,
      found: result.found,
      count: result.data.length,
      accounts: result.data.map(account => ({
        id: account.id,
        name: account.attributes.name,
        phone: account.attributes.phone_office,
        email: account.attributes.email1
      }))
    });
  } catch (error) {
    logger.error('Account search test failed', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test create call record
apiRouter.post('/api/test/crm/call', async (req, res) => {
  try {
    const {
      callerIdNum = '+1234567890',
      callerIdName = 'Test Caller',
      duration = 300,
      description = 'Test call created via API'
    } = req.body;

    const callData = {
      name: `Test Call from ${callerIdNum}`,
      callerIdNum,
      callerIdName,
      startTime: new Date().toISOString(),
      duration,
      status: 'Held',
      direction: 'Inbound',
      description,
      conversationId: `test-${Date.now()}`
    };

    const result = await suitecrmClient.createCall(callData);

    res.json({
      success: result.success,
      callId: result.id,
      message: 'Test call record created successfully',
      data: result.data
    });
  } catch (error) {
    logger.error('Create call test failed', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test update call record
apiRouter.patch('/api/test/crm/call/:callId', async (req, res) => {
  try {
    const { callId } = req.params;
    const updates = req.body;

    const result = await suitecrmClient.updateCall(callId, updates);

    res.json({
      success: result.success,
      message: 'Call record updated successfully',
      data: result.data
    });
  } catch (error) {
    logger.error('Update call test failed', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test get call record
apiRouter.get('/api/test/crm/call/:callId', async (req, res) => {
  try {
    const { callId } = req.params;
    const result = await suitecrmClient.getCall(callId);

    res.json({
      success: result.success,
      data: result.data
    });
  } catch (error) {
    logger.error('Get call test failed', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test full workflow (search + create + link)
apiRouter.post('/api/test/crm/workflow', async (req, res) => {
  try {
    const { phoneNumber = '+1234567890' } = req.body;
    const workflow = {
      steps: [],
      results: {}
    };

    // Step 1: Search for contact
    workflow.steps.push('Searching for contact...');
    const contactResult = await suitecrmClient.searchContactByPhone(phoneNumber);
    workflow.results.contactSearch = {
      found: contactResult.found,
      count: contactResult.data.length
    };

    // Step 2: Search for account
    workflow.steps.push('Searching for account...');
    const accountResult = await suitecrmClient.searchAccountByPhone(phoneNumber);
    workflow.results.accountSearch = {
      found: accountResult.found,
      count: accountResult.data.length
    };

    // Step 3: Create call record
    workflow.steps.push('Creating call record...');
    const callData = {
      name: `Test Workflow Call from ${phoneNumber}`,
      callerIdNum: phoneNumber,
      callerIdName: 'Test Workflow Caller',
      startTime: new Date().toISOString(),
      duration: 180,
      status: 'Held',
      direction: 'Inbound',
      description: 'Test call created via workflow test'
    };
    const callResult = await suitecrmClient.createCall(callData);
    workflow.results.callCreation = {
      success: callResult.success,
      callId: callResult.id
    };

    // Step 4: Link to contact if found
    if (contactResult.found && callResult.success) {
      workflow.steps.push('Linking to contact...');
      await suitecrmClient.linkCallToContact(callResult.id, contactResult.data[0].id);
      workflow.results.contactLink = { success: true };
    }

    // Step 5: Link to account if found
    if (accountResult.found && callResult.success) {
      workflow.steps.push('Linking to account...');
      await suitecrmClient.linkCallToAccount(callResult.id, accountResult.data[0].id);
      workflow.results.accountLink = { success: true };
    }

    workflow.steps.push('Workflow completed!');

    res.json({
      success: true,
      message: 'Full workflow test completed',
      workflow
    });
  } catch (error) {
    logger.error('Workflow test failed', error);
    res.status(500).json({
      success: false,
      error: error.message,
      workflow: req.body
    });
  }
});

// Initialize services
logger.info('Initializing CTI Middleware services...');

const freepbxClient = new FreePBXClient(config.get('freepbx.ami'), logger);
const elevenLabsWebhook = new ElevenLabsWebhook(config.get('elevenlabs'), logger);
const suitecrmClient = new SuiteCRMClient(config.get('suitecrm'), logger, config.get('elevenlabs.apiKey'));
const wsServer = new WebSocketServer(config.get('websocket'), logger);
const ctiMiddleware = new CTIMiddleware(
  freepbxClient,
  elevenLabsWebhook,
  suitecrmClient,
  wsServer,
  logger
);

// Mount ElevenLabs webhook routes to API router
apiRouter.use(elevenLabsWebhook.getRouter());

// Mount API router with prefix
app.use(API_PREFIX, apiRouter);

// Root redirect
app.get('/', (req, res) => {
  res.json({
    service: 'CTI Middleware',
    version: '1.0.0',
    endpoints: {
      health: `${API_PREFIX}/health`,
      status: `${API_PREFIX}/api/status`,
      activeCalls: `${API_PREFIX}/api/calls/active`,
      agents: `${API_PREFIX}/api/agents`,
      screenPop: `${API_PREFIX}/api/screen-pop`,
      webhook: `${API_PREFIX}/webhook/elevenlabs`,
      websocket: '/ws'
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    hint: `All API endpoints are under ${API_PREFIX}. Try ${API_PREFIX}/health`
  });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', err, {
    method: req.method,
    path: req.path,
    ip: req.ip
  });

  res.status(err.status || 500).json({
    error: config.isDevelopment() ? err.message : 'Internal server error'
  });
});

// Initialize and start server
async function start() {
  try {
    logger.info('Starting CTI Middleware...', {
      environment: config.get('server.environment'),
      port: config.get('server.port')
    });

    // Initialize CTI Middleware (connects to FreePBX and tests SuiteCRM)
    await ctiMiddleware.initialize();

    // Initialize WebSocket server
    wsServer.initialize(server);

    // Start HTTP server
    const port = config.get('server.port');
    server.listen(port, () => {
      logger.info(`CTI Middleware server started`, {
        httpPort: port,
        wsPath: '/ws',
        environment: config.get('server.environment')
      });

      console.log('\n===========================================');
      console.log(`🚀 CTI Middleware Server Running`);
      console.log(`===========================================`);
      console.log(`HTTP Server: http://localhost:${port}`);
      console.log(`API Prefix: ${API_PREFIX}`);
      console.log(`WebSocket: ws://localhost:${port}/ws`);
      console.log(`Health Check: http://localhost:${port}${API_PREFIX}/health`);
      console.log(`Environment: ${config.get('server.environment')}`);
      console.log('===========================================\n');
    });

    // Cleanup old calls every 10 minutes
    setInterval(() => {
      ctiMiddleware.cleanupOldCalls(60);
    }, 10 * 60 * 1000);

    // Graceful shutdown handlers
    const shutdown = async (signal) => {
      logger.info(`Received ${signal}, starting graceful shutdown...`);

      server.close(async () => {
        logger.info('HTTP server closed');
        await ctiMiddleware.shutdown();
        process.exit(0);
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', error);
      shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', reason);
    });

  } catch (error) {
    logger.error('Failed to start CTI Middleware', error);
    process.exit(1);
  }
}

// Start the application
start();

module.exports = app;

