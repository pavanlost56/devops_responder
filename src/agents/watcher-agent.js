import { eliza } from '../index';

class WatcherAgent {
  constructor() {
    this.thresholds = {
      cpu: 85, // CPU usage threshold (%)
      memory: 90, // Memory usage threshold (%)
      disk: 85, // Disk usage threshold (%)
      errorRate: 5 // Error rate per minute threshold
    };
  }

  async start() {
    // Subscribe to metrics and logs events
    eliza.bus.subscribe('metrics.*', this.handleMetrics.bind(this));
    eliza.bus.subscribe('logs.*', this.handleLogs.bind(this));
  }

  async handleMetrics(event, data) {
    // Check for metric-based anomalies
    const anomalies = [];

    if (data.cpu > this.thresholds.cpu) {
      anomalies.push(`High CPU usage: ${data.cpu}%`);
    }
    if (data.memory > this.thresholds.memory) {
      anomalies.push(`High memory usage: ${data.memory}%`);
    }
    if (data.disk > this.thresholds.disk) {
      anomalies.push(`High disk usage: ${data.disk}%`);
    }

    if (anomalies.length > 0) {
      await this.createIncident('metric_anomaly', {
        source: event,
        anomalies,
        data
      });
    }
  }

  async handleLogs(event, data) {
    // Track error rates in rolling window
    const errorPattern = /error|exception|failure|failed/i;
    if (errorPattern.test(data.message)) {
      const errorCount = await this.getErrorCount(data.service, '1m');
      if (errorCount > this.thresholds.errorRate) {
        await this.createIncident('log_anomaly', {
          source: event,
          service: data.service,
          errorCount,
          data
        });
      }
    }
  }

  async createIncident(type, details) {
    // Create new incident room
    const room = await eliza.rooms.create({
      type: 'incident',
      title: `Incident: ${type} at ${new Date().toISOString()}`
    });

    // Post initial details to room
    await room.post({
      type: 'incident_details',
      content: `Anomaly detected:\n${JSON.stringify(details, null, 2)}`
    });

    // Publish incident.created event
    await eliza.bus.publish('incident.created', {
      roomId: room.id,
      type,
      details,
      timestamp: new Date().toISOString()
    });
  }

  async getErrorCount(service, timeWindow) {
    // Get error count from metrics store for given service and time window
    // This is a placeholder - implement actual metrics query
    const metrics = await eliza.metrics.query({
      service,
      timeWindow,
      metric: 'error_count'
    });
    return metrics.value || 0;
  }
}

export const agent = new WatcherAgent();