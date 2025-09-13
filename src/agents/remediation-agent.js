import { eliza } from '../index';

class RemediationAgent {
  constructor() {
    this.auditRoom = null;
  }

  async start() {
    // Get or create audit room
    this.auditRoom = await this.getAuditRoom();
    
    // Subscribe to triage events
    eliza.bus.subscribe('incident.triaged', this.handleTriagedIncident.bind(this));
  }

  async getAuditRoom() {
    // Get or create the audit room
    const rooms = await eliza.rooms.list({ type: 'audit' });
    if (rooms.length > 0) {
      return rooms[0];
    }
    return eliza.rooms.create({
      type: 'audit',
      title: 'Incident Remediation Audit Log'
    });
  }

  async handleTriagedIncident(event) {
    const { roomId, analysis } = event;
    const room = await eliza.rooms.get(roomId);

    // Generate remediation steps
    const remediationPlan = await this.generateRemediationPlan(analysis);

    // Post remediation plan to incident room
    await room.post({
      type: 'remediation_plan',
      content: this.formatRemediationPlan(remediationPlan)
    });

    // Create approval buttons
    await this.requestApproval(room, remediationPlan);
  }

  async generateRemediationPlan(analysis) {
    // Use LLM to suggest remediation steps based on analysis
    const response = await eliza.llm.analyze({
      model: 'gpt-4',
      prompt: this.buildRemediationPrompt(analysis),
      temperature: 0.2
    });

    return {
      steps: response.steps.map((step, index) => ({
        id: `step-${index + 1}`,
        description: step.description,
        command: step.command,
        rollback: step.rollback,
        risk: step.risk || 'low'
      })),
      estimatedTime: response.estimatedTime || '5-10 minutes',
      risks: response.risks || ['No major risks identified']
    };
  }

  buildRemediationPrompt(analysis) {
    return `Based on this incident analysis, suggest safe remediation steps:
      1. Each step should be reversible
      2. Include rollback commands
      3. Assess risk level for each step
      4. No destructive actions allowed

      Analysis:
      ${JSON.stringify(analysis, null, 2)}`;
  }

  formatRemediationPlan(plan) {
    return `## Proposed Remediation Plan
      
      **Estimated Time:** ${plan.estimatedTime}
      
      **Steps:**
      ${plan.steps.map((step, i) => `
      ${i + 1}. ${step.description}
         Command: \`${step.command}\`
         Rollback: \`${step.rollback}\`
         Risk: ${step.risk}
      `).join('\n')}
      
      **Potential Risks:**
      ${plan.risks.map(risk => `• ${risk}`).join('\n')}
      
      *Requires approval before execution*`;
  }

  async requestApproval(room, plan) {
    await room.post({
      type: 'action_request',
      content: 'Remediation Plan Approval',
      actions: [
        {
          id: 'approve_all',
          label: '✅ Approve All Steps',
          handler: () => this.executeRemediation(room, plan.steps)
        },
        {
          id: 'approve_selective',
          label: '🔍 Approve Selective Steps',
          handler: () => this.showStepSelection(room, plan.steps)
        },
        {
          id: 'reject',
          label: '❌ Reject Plan',
          handler: () => this.rejectPlan(room)
        }
      ]
    });
  }

  async executeRemediation(room, steps) {
    for (const step of steps) {
      // Log action to audit room
      await this.auditRoom.post({
        type: 'remediation_action',
        content: `Executing: ${step.description}\nCommand: ${step.command}`
      });

      try {
        // Execute the remediation command
        await eliza.exec.run(step.command);
        
        // Log success
        await room.post({
          type: 'remediation_status',
          content: `✅ Completed: ${step.description}`
        });
      } catch (error) {
        // Log failure and execute rollback
        await room.post({
          type: 'remediation_status',
          content: `❌ Failed: ${step.description}\nError: ${error.message}\nExecuting rollback...`
        });

        // Execute rollback command
        try {
          await eliza.exec.run(step.rollback);
          await room.post({
            type: 'remediation_status',
            content: `↩️ Rollback completed for: ${step.description}`
          });
        } catch (rollbackError) {
          await room.post({
            type: 'remediation_status',
            content: `⚠️ Rollback failed: ${rollbackError.message}\nManual intervention required!`
          });
        }
        
        // Stop execution after failure
        break;
      }
    }
  }

  async showStepSelection(room, steps) {
    await room.post({
      type: 'action_request',
      content: 'Select steps to execute:',
      actions: steps.map(step => ({
        id: `execute_${step.id}`,
        label: `Execute: ${step.description}`,
        handler: () => this.executeRemediation(room, [step])
      }))
    });
  }

  async rejectPlan(room) {
    await room.post({
      type: 'remediation_status',
      content: '❌ Remediation plan rejected. Please provide alternative suggestions.'
    });
  }
}

export const agent = new RemediationAgent();