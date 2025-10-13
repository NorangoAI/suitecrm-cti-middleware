const fs = require('fs');
const path = require('path');
require('dotenv').config();

class Config {
  constructor() {
    // Load config.json
    const configPath = path.join(process.cwd(), 'config.json');
    let fileConfig = {};

    if (fs.existsSync(configPath)) {
      const configFile = fs.readFileSync(configPath, 'utf8');
      fileConfig = JSON.parse(configFile);
    }

    // Merge with environment variables (env vars take precedence)
    this.config = {
      server: {
        port: parseInt(process.env.PORT) || fileConfig.server?.port || 3000,
        wsPort: parseInt(process.env.WS_PORT) || fileConfig.server?.wsPort || 3001,
        environment: process.env.NODE_ENV || fileConfig.server?.environment || 'development'
      },
      freepbx: {
        ami: {
          host: process.env.AMI_HOST || fileConfig.freepbx?.ami?.host || 'localhost',
          port: parseInt(process.env.AMI_PORT) || fileConfig.freepbx?.ami?.port || 5038,
          username: process.env.AMI_USERNAME || fileConfig.freepbx?.ami?.username,
          secret: process.env.AMI_SECRET || fileConfig.freepbx?.ami?.secret,
          reconnect: fileConfig.freepbx?.ami?.reconnect !== false,
          reconnectAfter: fileConfig.freepbx?.ami?.reconnectAfter || 3000
        }
      },
      elevenlabs: {
        webhookSecret: process.env.ELEVENLABS_WEBHOOK_SECRET || '',
        webhookPath: fileConfig.elevenlabs?.webhookPath || '/webhook/elevenlabs',
        signatureHeader: fileConfig.elevenlabs?.signatureHeader || 'elevenlabs-signature',
        timestampTolerance: fileConfig.elevenlabs?.timestampTolerance || 1800
      },
      suitecrm: {
        baseUrl: process.env.SUITECRM_URL || fileConfig.suitecrm?.baseUrl,
        apiVersion: fileConfig.suitecrm?.apiVersion || 'V8',
        clientId: process.env.SUITECRM_CLIENT_ID || '',
        clientSecret: process.env.SUITECRM_CLIENT_SECRET || '',
        username: process.env.SUITECRM_USERNAME || '',
        password: process.env.SUITECRM_PASSWORD || '',
        timeout: fileConfig.suitecrm?.timeout || 30000,
        retryAttempts: fileConfig.suitecrm?.retryAttempts || 3,
        retryDelay: fileConfig.suitecrm?.retryDelay || 1000
      },
      websocket: {
        pingInterval: fileConfig.websocket?.pingInterval || 30000,
        maxConnections: fileConfig.websocket?.maxConnections || 100
      },
      logging: {
        level: process.env.LOG_LEVEL || fileConfig.logging?.level || 'info',
        directory: process.env.LOG_DIR || fileConfig.logging?.directory || './logs',
        maxFiles: fileConfig.logging?.maxFiles || '14d',
        maxSize: fileConfig.logging?.maxSize || '20m'
      },
      security: {
        apiKey: process.env.API_KEY || '',
        allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || fileConfig.security?.allowedOrigins || [],
        rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || fileConfig.security?.rateLimitWindowMs || 900000,
        rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || fileConfig.security?.rateLimitMaxRequests || 100,
        requireApiKey: fileConfig.security?.requireApiKey !== false
      }
    };

    this.validate();
  }

  validate() {
    const errors = [];

    // Validate FreePBX AMI config
    if (!this.config.freepbx.ami.username || !this.config.freepbx.ami.secret) {
      errors.push('FreePBX AMI credentials are required (AMI_USERNAME, AMI_SECRET)');
    }

    // Validate ElevenLabs config
    if (!this.config.elevenlabs.webhookSecret) {
      console.warn('Warning: ELEVENLABS_WEBHOOK_SECRET not set. Webhook signature verification will be skipped.');
    }

    // Validate SuiteCRM config
    if (!this.config.suitecrm.baseUrl) {
      errors.push('SuiteCRM URL is required (SUITECRM_URL)');
    }
    if (!this.config.suitecrm.clientId || !this.config.suitecrm.clientSecret) {
      errors.push('SuiteCRM OAuth2 credentials are required (SUITECRM_CLIENT_ID, SUITECRM_CLIENT_SECRET)');
    }

    if (errors.length > 0) {
      throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
  }

  get(path) {
    return path.split('.').reduce((obj, key) => obj?.[key], this.config);
  }

  getAll() {
    return this.config;
  }

  isProduction() {
    return this.config.server.environment === 'production';
  }

  isDevelopment() {
    return this.config.server.environment === 'development';
  }
}

module.exports = new Config();

