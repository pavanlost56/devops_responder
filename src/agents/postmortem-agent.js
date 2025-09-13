import { eliza } from '../index';

class PostmortemAgent {
  constructor() {
    // Create postmortems directory if it doesn't exist
    eliza.fs.mkdirp('/postmortems');
  }

  async start() {
    // Subscribe to incident resolution events
    eliza.bus.subscribe('incident.resolved', this.handleResolution.bind(this));
  }

  async handleResolution(event) {
    const { roomId } = event;
    const room = await eliza.rooms.get(roomId);

    // Collect all incident information
    const incidentData = await this.collectIncidentData(room);

    // Generate postmortem document
    const postmortem = await this.generatePostmortem(incidentData);

    // Save postmortem
    await this.savePostmortem(postmortem);

    // Index in vector DB for future reference
    await this.indexPostmortem(postmortem);

    // Post link to postmortem in incident room
    await room.post({
      type: 'postmortem_link',
      content: `📝 Postmortem generated: [${postmortem.title}](${postmortem.url})`
    });
  }

  async collectIncidentData(room) {
    // Get all messages from the incident room
    const messages = await room.getMessages();

    // Extract key events and timestamps
    const timeline = messages.map(msg => ({
      timestamp: msg.timestamp,
      type: msg.type,
      content: msg.content
    }));

    // Find the triage analysis
    const triageAnalysis = messages.find(m => m.type === 'triage_analysis')?.content;

    // Find the remediation actions
    const remediationActions = messages
      .filter(m => m.type === 'remediation_status')
      .map(m => m.content);

    return {
      incidentId: room.id,
      title: room.title,
      timeline,
      analysis: triageAnalysis,
      remediation: remediationActions,
      duration: this.calculateDuration(timeline)
    };
  }

  async generatePostmortem(data) {
    // Use LLM to generate structured postmortem
    const response = await eliza.llm.analyze({
      model: 'gpt-4',
      prompt: this.buildPostmortemPrompt(data),
      temperature: 0.3
    });

    return {
      id: `pm-${data.incidentId}`,
      title: `Postmortem: ${data.title}`,
      content: response.content,
      metadata: {
        date: new Date().toISOString(),
        duration: data.duration,
        severity: response.severity,
        impact: response.impact,
        rootCause: response.rootCause,
        actionItems: response.actionItems
      }
    };
  }

  buildPostmortemPrompt(data) {
    return `Generate a comprehensive postmortem for this incident:

    Incident Data:
    ${JSON.stringify(data, null, 2)}

    Include:
    1. Executive Summary
    2. Timeline of Events
    3. Root Cause Analysis
    4. Impact Assessment
    5. What Went Well
    6. What Went Wrong
    7. Action Items
    8. Lessons Learned`;
  }

  async savePostmortem(postmortem) {
    // Save as markdown file
    const filename = `${postmortem.id}-${this.sanitizeFilename(postmortem.title)}.md`;
    const path = `/postmortems/${filename}`;

    await eliza.fs.write(path, this.formatPostmortem(postmortem));

    // Add file URL to postmortem object
    postmortem.url = `file://${path}`;
    return postmortem;
  }

  async indexPostmortem(postmortem) {
    // Index in vector DB for similarity search
    await eliza.vectorDb.index('postmortems', {
      id: postmortem.id,
      title: postmortem.title,
      content: postmortem.content,
      metadata: postmortem.metadata
    });
  }

  formatPostmortem(postmortem) {
    return `# ${postmortem.title}

## Metadata
- Date: ${postmortem.metadata.date}
- Duration: ${postmortem.metadata.duration}
- Severity: ${postmortem.metadata.severity}
- Impact: ${postmortem.metadata.impact}

${postmortem.content}

## Action Items
${postmortem.metadata.actionItems.map(item => `- [ ] ${item}`).join('\n')}`;
  }

  calculateDuration(timeline) {
    if (timeline.length < 2) return 'Unknown';
    
    const start = new Date(timeline[0].timestamp);
    const end = new Date(timeline[timeline.length - 1].timestamp);
    const minutes = Math.round((end - start) / 60000);

    if (minutes < 60) {
      return `${minutes} minutes`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }

  sanitizeFilename(filename) {
    return filename
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}

export const agent = new PostmortemAgent();