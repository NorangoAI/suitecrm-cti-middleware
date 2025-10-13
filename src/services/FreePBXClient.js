const AsteriskManager = require('asterisk-manager');
const EventEmitter = require('events');

class FreePBXClient extends EventEmitter {
  constructor(config, logger) {
    super();
    this.config = config;
    this.logger = logger;
    this.ami = null;
    this.connected = false;
    this.reconnectTimer = null;
    this.activeChannels = new Map();
  }

  /**
   * Initialize and connect to AMI
   */
  async connect() {
    try {
      this.ami = new AsteriskManager(
        this.config.port,
        this.config.host,
        this.config.username,
        this.config.secret,
        true // Enable events
      );

      // Set up event listeners
      this.setupEventListeners();

      // Connect to AMI
      await new Promise((resolve, reject) => {
        this.ami.on('connect', () => {
          this.connected = true;
          this.logger.info('Connected to FreePBX AMI', {
            host: this.config.host,
            port: this.config.port
          });
          resolve();
        });

        this.ami.on('error', (error) => {
          this.logger.error('AMI Connection error', error);
          reject(error);
        });

        // Initiate connection
        this.ami.keepConnected();
      });

      return true;
    } catch (error) {
      this.logger.error('Failed to connect to FreePBX AMI', error);
      this.handleReconnect();
      throw error;
    }
  }

  /**
   * Set up all AMI event listeners
   */
  setupEventListeners() {
    // Connection events
    this.ami.on('connect', () => {
      this.connected = true;
      this.emit('connected');
      this.logger.logAMIEvent('Connected');
    });

    this.ami.on('close', () => {
      this.connected = false;
      this.emit('disconnected');
      this.logger.logAMIEvent('Disconnected');
      this.handleReconnect();
    });

    // Call events
    this.ami.on('managerevent', (event) => {
      this.handleEvent(event);
    });

    // Newchannel - new call initiated
    this.ami.on('newchannel', (event) => {
      this.logger.logAMIEvent('NewChannel', event);
      this.handleNewChannel(event);
    });

    // Newstate - channel state changed
    this.ami.on('newstate', (event) => {
      this.logger.logAMIEvent('NewState', event);
      this.handleStateChange(event);
    });

    // Dial - outgoing call
    this.ami.on('dial', (event) => {
      this.logger.logAMIEvent('Dial', event);
      this.handleDial(event);
    });

    // Hangup - call ended
    this.ami.on('hangup', (event) => {
      this.logger.logAMIEvent('Hangup', event);
      this.handleHangup(event);
    });

    // Bridge - calls connected
    this.ami.on('bridge', (event) => {
      this.logger.logAMIEvent('Bridge', event);
      this.handleBridge(event);
    });
  }

  /**
   * Handle generic AMI events
   */
  handleEvent(event) {
    const eventName = event.event?.toLowerCase();

    switch (eventName) {
      case 'newchannel':
        this.handleNewChannel(event);
        break;
      case 'newstate':
        this.handleStateChange(event);
        break;
      case 'dial':
        this.handleDial(event);
        break;
      case 'hangup':
        this.handleHangup(event);
        break;
      case 'bridge':
        this.handleBridge(event);
        break;
      default:
        // Log other events at debug level
        this.logger.debug(`AMI Event: ${eventName}`, event);
    }
  }

  /**
   * Handle new channel (incoming/outgoing call)
   */
  handleNewChannel(event) {
    const channelData = {
      channel: event.channel,
      callerIdNum: event.calleridnum,
      callerIdName: event.calleridname,
      context: event.context,
      exten: event.exten,
      state: event.channelstate,
      timestamp: new Date().toISOString(),
      uniqueId: event.uniqueid
    };

    this.activeChannels.set(event.uniqueid, channelData);

    this.emit('call:new', channelData);

    this.logger.info('New channel created', {
      callerId: event.calleridnum,
      channel: event.channel
    });
  }

  /**
   * Handle channel state changes
   */
  handleStateChange(event) {
    const uniqueId = event.uniqueid;

    if (this.activeChannels.has(uniqueId)) {
      const channelData = this.activeChannels.get(uniqueId);
      channelData.state = event.channelstate;
      channelData.stateDesc = event.channelstatedesc;

      this.emit('call:state', channelData);
    }
  }

  /**
   * Handle dial events (outgoing calls)
   */
  handleDial(event) {
    const dialData = {
      sourceChannel: event.channel,
      destChannel: event.destchannel,
      callerIdNum: event.calleridnum,
      callerIdName: event.calleridname,
      destination: event.destination,
      dialStatus: event.dialstatus,
      timestamp: new Date().toISOString()
    };

    this.emit('call:dial', dialData);

    this.logger.info('Dial event', {
      from: event.calleridnum,
      to: event.destination,
      status: event.dialstatus
    });
  }

  /**
   * Handle hangup events
   */
  handleHangup(event) {
    const uniqueId = event.uniqueid;
    const channelData = this.activeChannels.get(uniqueId);

    const hangupData = {
      channel: event.channel,
      callerIdNum: event.calleridnum,
      cause: event.cause,
      causeTxt: event.causetxt,
      timestamp: new Date().toISOString(),
      uniqueId: uniqueId,
      duration: channelData ? this.calculateDuration(channelData.timestamp) : 0
    };

    this.emit('call:hangup', hangupData);

    this.activeChannels.delete(uniqueId);

    this.logger.info('Call ended', {
      callerId: event.calleridnum,
      cause: event.causetxt,
      duration: hangupData.duration
    });
  }

  /**
   * Handle bridge events (calls connected)
   */
  handleBridge(event) {
    const bridgeData = {
      channel1: event.channel1,
      channel2: event.channel2,
      uniqueId1: event.uniqueid1,
      uniqueId2: event.uniqueid2,
      bridgeState: event.bridgestate,
      timestamp: new Date().toISOString()
    };

    this.emit('call:bridge', bridgeData);

    this.logger.info('Calls bridged', {
      channel1: event.channel1,
      channel2: event.channel2
    });
  }

  /**
   * Calculate call duration in seconds
   */
  calculateDuration(startTime) {
    const start = new Date(startTime);
    const end = new Date();
    return Math.floor((end - start) / 1000);
  }

  /**
   * Get active channel information
   */
  getActiveChannel(uniqueId) {
    return this.activeChannels.get(uniqueId);
  }

  /**
   * Get all active channels
   */
  getAllActiveChannels() {
    return Array.from(this.activeChannels.values());
  }

  /**
   * Handle reconnection logic
   */
  handleReconnect() {
    if (!this.config.reconnect) {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      this.logger.info('Attempting to reconnect to AMI...');
      this.connect().catch(() => {
        // Will retry again due to handleReconnect being called on error
      });
    }, this.config.reconnectAfter);
  }

  /**
   * Send AMI action
   */
  async sendAction(action, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        return reject(new Error('AMI not connected'));
      }

      const actionData = { action, ...params };

      this.ami.action(actionData, (err, res) => {
        if (err) {
          this.logger.error(`AMI action failed: ${action}`, err);
          return reject(err);
        }
        resolve(res);
      });
    });
  }

  /**
   * Originate a call
   */
  async originateCall(channel, extension, context = 'from-internal', callerIdNum = '', callerIdName = '') {
    try {
      const result = await this.sendAction('Originate', {
        Channel: channel,
        Exten: extension,
        Context: context,
        Priority: 1,
        CallerID: callerIdNum ? `"${callerIdName}" <${callerIdNum}>` : undefined,
        Async: 'true'
      });

      this.logger.info('Call originated', { channel, extension, context });
      return result;
    } catch (error) {
      this.logger.error('Failed to originate call', error, { channel, extension });
      throw error;
    }
  }

  /**
   * Disconnect from AMI
   */
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.ami) {
      this.ami.disconnect();
      this.connected = false;
      this.logger.info('Disconnected from FreePBX AMI');
    }
  }

  /**
   * Check if connected
   */
  isConnected() {
    return this.connected;
  }
}

module.exports = FreePBXClient;

