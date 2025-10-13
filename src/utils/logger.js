const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

class Logger {
  constructor(config = {}) {
    const logDir = config.directory || './logs';

    // Ensure log directory exists
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Define log format
    const logFormat = winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'label'] }),
      winston.format.printf(({ timestamp, level, message, metadata }) => {
        let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
        if (Object.keys(metadata).length > 0) {
          log += ` | ${JSON.stringify(metadata)}`;
        }
        return log;
      })
    );

    // Create transports
    const transports = [
      // Console transport
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          logFormat
        )
      }),

      // Combined log file (all logs)
      new DailyRotateFile({
        filename: path.join(logDir, 'combined-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: config.maxSize || '20m',
        maxFiles: config.maxFiles || '14d',
        format: logFormat
      }),

      // Error log file (errors only)
      new DailyRotateFile({
        filename: path.join(logDir, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize: config.maxSize || '20m',
        maxFiles: config.maxFiles || '14d',
        format: logFormat
      })
    ];

    // Create logger instance
    this.logger = winston.createLogger({
      level: config.level || 'info',
      transports: transports,
      exitOnError: false
    });

    this.logger.info('Logger initialized', { config: { level: config.level, directory: logDir } });
  }

  info(message, metadata = {}) {
    this.logger.info(message, metadata);
  }

  warn(message, metadata = {}) {
    this.logger.warn(message, metadata);
  }

  error(message, error = null, metadata = {}) {
    if (error instanceof Error) {
      this.logger.error(message, {
        ...metadata,
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name
        }
      });
    } else {
      this.logger.error(message, { ...metadata, error });
    }
  }

  debug(message, metadata = {}) {
    this.logger.debug(message, metadata);
  }

  verbose(message, metadata = {}) {
    this.logger.verbose(message, metadata);
  }

  // Log AMI events
  logAMIEvent(event, data = {}) {
    this.info(`AMI Event: ${event}`, { type: 'ami', event, data });
  }

  // Log webhook events
  logWebhook(source, event, data = {}) {
    this.info(`Webhook received: ${source}`, { type: 'webhook', source, event, data });
  }

  // Log API calls
  logAPICall(service, method, endpoint, status, duration = null) {
    this.info(`API Call: ${service} ${method} ${endpoint}`, {
      type: 'api',
      service,
      method,
      endpoint,
      status,
      duration
    });
  }

  // Log WebSocket events
  logWSEvent(event, data = {}) {
    this.info(`WebSocket: ${event}`, { type: 'websocket', event, data });
  }
}

module.exports = Logger;

