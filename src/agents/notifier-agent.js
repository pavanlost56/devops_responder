import { eliza } from '../index';

class NotifierAgent {
  constructor() {
    this.transports = {
      console: true, // Console always available
      slack: false,
      discord: false
    };
  }

  async start() {
    // Initialize available notification transports
    await this.initTransports();
    
    // Subscribe to triage events
    eliza.bus.subscribe('incident.triaged', this.handleTriageComplete.bind(this));
  }

  async initTransports() {
    // Check which notification transports are available
    try {
      this.transports.slack = await eliza.transports.has('slack');
      this.transports.discord = await eliza.transports.has('discord');
    } catch (error) {
      console.warn('Error checking transports:', error);
    }
  }

  async handleTriageComplete(event) {
    const { roomId, analysis } = event;
    const room = await eliza.rooms.get(roomId);

    // Format notification message
    const message = this.formatMessage(room, analysis);

    // Send to all available transports
    await this.notify(message, analysis.severity);
  }

  formatMessage(room, analysis) {
    const severity = this.getSeverityEmoji(analysis.severity);
    
    return {
      title: `${severity} New Incident: ${room.title}`,
      body: `
*Root Cause(s):*
${analysis.rootCauses.map(cause => `• ${cause}`).join('\n')}

*Severity:* ${analysis.severity}
*Impact:* ${analysis.impact}

View incident: ${room.url}`,
      color: this.getSeverityColor(analysis.severity)
    };
  }

  async notify(message, severity) {
    const notifications = [];

    // Always log to console
    notifications.push(
      this.sendConsole(message)
    );

    // Send to Slack if available
    if (this.transports.slack) {
      notifications.push(
        this.sendSlack(message)
      );
    }

    // Send to Discord if available
    if (this.transports.discord) {
      notifications.push(
        this.sendDiscord(message)
      );
    }

    // Wait for all notifications to complete
    await Promise.all(notifications);
  }

  async sendConsole(message) {
    console.log('\n' + message.title);
    console.log(message.body);
  }

  async sendSlack(message) {
    return eliza.transports.slack.send({
      channel: this.getSeverityChannel(message.severity),
      text: message.title,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: message.body
          }
        }
      ]
    });
  }

  async sendDiscord(message) {
    return eliza.transports.discord.send({
      channel: this.getSeverityChannel(message.severity),
      embeds: [
        {
          title: message.title,
          description: message.body,
          color: message.color
        }
      ]
    });
  }

  getSeverityEmoji(severity) {
    const emojis = {
      P0: '🔴',
      P1: '🟠',
      P2: '🟡',
      P3: '🟢'
    };
    return emojis[severity] || '⚪';
  }

  getSeverityColor(severity) {
    const colors = {
      P0: '#FF0000',
      P1: '#FFA500',
      P2: '#FFFF00',
      P3: '#00FF00'
    };
    return colors[severity] || '#FFFFFF';
  }

  getSeverityChannel(severity) {
    // Map severity to appropriate channel
    return severity === 'P0' || severity === 'P1' 
      ? 'incidents-critical'
      : 'incidents-general';
  }
}

export const agent = new NotifierAgent();