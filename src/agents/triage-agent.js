import { eliza } from '../index';

class TriageAgent {
  constructor() {
    this.config = eliza.config.load('triage-agent.json');
  }

  async start() {
    eliza.bus.subscribe('incident.created', this.handleIncident.bind(this));
  }

  async handleIncident(event) {
    const { roomId, type, details } = event;
    const room = await eliza.rooms.get(roomId);

    // Collect context for analysis
    const context = await this.gatherContext(details);

    // Generate analysis using LLM
    const analysis = await this.analyzeIncident(context);

    // Post findings to incident room
    await room.post({
      type: 'triage_analysis',
      content: `## Incident Analysis
        
        **Root Cause(s):**
        ${analysis.rootCauses.join('\n')}
        
        **Severity:** ${analysis.severity}
        
        **Impact:**
        ${analysis.impact}
        
        **Confidence:** ${analysis.confidence * 100}%`
    });

    // Publish triage completion event
    await eliza.bus.publish('incident.triaged', {
      roomId,
      type,
      analysis,
      timestamp: new Date().toISOString()
    });
  }

  async gatherContext(details) {
    const timeWindow = '15m'; // Look back 15 minutes
    const { source, service } = details;

    // Collect relevant logs
    const logs = await eliza.logs.query({
      service,
      timeWindow,
      limit: 100
    });

    // Collect relevant metrics
    const metrics = await eliza.metrics.query({
      service,
      timeWindow,
      metrics: ['cpu', 'memory', 'error_rate', 'latency']
    });

    return {
      incident: details,
      logs,
      metrics
    };
  }

  async analyzeIncident(context) {
    // Call LLM for analysis
    const llmResponse = await eliza.llm.analyze({
      model: this.config.llmModel,
      prompt: this.buildAnalysisPrompt(context),
      temperature: 0.3
    });

    // Parse and validate response
    const analysis = this.parseAnalysis(llmResponse);
    
    if (analysis.confidence < this.config.confidenceThreshold) {
      analysis.rootCauses.push('Low confidence - manual investigation recommended');
    }

    return analysis;
  }

  buildAnalysisPrompt(context) {
    return `Analyze this incident context and determine:
      1. Most likely root cause(s)
      2. Severity level (P0-P3)
      3. Business impact
      4. Confidence in analysis

      Context:
      ${JSON.stringify(context, null, 2)}`;
  }

  parseAnalysis(llmResponse) {
    // Parse LLM response into structured format
    // This is a simplified example
    return {
      rootCauses: llmResponse.rootCauses || [],
      severity: llmResponse.severity || 'P2',
      impact: llmResponse.impact || 'Unknown',
      confidence: llmResponse.confidence || 0.5
    };
  }
}

export const agent = new TriageAgent();