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

// Rate limiting
const limiter = rateLimit({
  windowMs: config.get('security.rateLimitWindowMs'),
  max: config.get('security.rateLimitMaxRequests'),
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/webhook', limiter);

// Body parser for JSON (except webhook routes which use raw body)
app.use((req, res, next) => {
  if (req.path.startsWith('/webhook/')) {
    next();
  } else {
    express.json()(req, res, next);
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

// Apply API key validation to protected routes
app.use('/api', validateApiKey);

// Health check endpoint
app.get('/health', (req, res) => {
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
app.get('/api/status', (req, res) => {
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
app.get('/api/calls/active', (req, res) => {
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
app.get('/api/agents', (req, res) => {
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
app.post('/api/screen-pop', (req, res) => {
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

// Initialize services
logger.info('Initializing CTI Middleware services...');

const freepbxClient = new FreePBXClient(config.get('freepbx.ami'), logger);
const elevenLabsWebhook = new ElevenLabsWebhook(config.get('elevenlabs'), logger);
const suitecrmClient = new SuiteCRMClient(config.get('suitecrm'), logger);
const wsServer = new WebSocketServer(config.get('websocket'), logger);
const ctiMiddleware = new CTIMiddleware(
  freepbxClient,
  elevenLabsWebhook,
  suitecrmClient,
  wsServer,
  logger
);

// Mount ElevenLabs webhook routes
app.use(elevenLabsWebhook.getRouter());

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
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
      console.log(`WebSocket: ws://localhost:${port}/ws`);
      console.log(`Health Check: http://localhost:${port}/health`);
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

