#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
// Fixed chalk import for ESM
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';

// Configuration pour les logs
const LOGS_DIR = '/tmp/mcp-logs';
const SERVER_LOG = path.join(LOGS_DIR, 'server-debug.log');
const RESPONSE_DIR = path.join(LOGS_DIR, 'responses');

// Fonction pour écrire dans le fichier de log
function logToFile(message: string): void {
  // S'assurer que le répertoire existe
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
  
  // S'assurer que le répertoire des réponses existe
  if (!fs.existsSync(RESPONSE_DIR)) {
    fs.mkdirSync(RESPONSE_DIR, { recursive: true });
  }
  
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  
  // Ajouter au fichier de log
  fs.appendFileSync(SERVER_LOG, logMessage);
  
  // Aussi afficher dans la console pour le debug
  console.error(`[DEBUG] ${message}`);
}

// Fonction pour sauvegarder la réponse dans un fichier
function saveResponseToFile(requestId: string, response: any): void {
  try {
    if (!requestId) {
      logToFile('Tentative de sauvegarde d\'une réponse sans ID de requête');
      return;
    }
    
    const responseFilePath = path.join(RESPONSE_DIR, `${requestId}.json`);
    fs.writeFileSync(responseFilePath, JSON.stringify(response, null, 2));
    logToFile(`Réponse sauvegardée dans le fichier: ${responseFilePath}`);
  } catch (error) {
    logToFile(`Erreur lors de la sauvegarde de la réponse: ${error}`);
  }
}

interface ThoughtData {
  thought: string;
  thoughtNumber: number;
  totalThoughts: number;
  isRevision?: boolean;
  revisesThought?: number;
  branchFromThought?: number;
  branchId?: string;
  needsMoreThoughts?: boolean;
  nextThoughtNeeded: boolean;
}

class SequentialThinkingServer {
  private thoughtHistory: ThoughtData[] = [];
  private branches: Record<string, ThoughtData[]> = {};

  private validateThoughtData(input: unknown): ThoughtData {
    const data = input as Record<string, unknown>;

    if (!data.thought || typeof data.thought !== 'string') {
      throw new Error('Invalid thought: must be a string');
    }
    if (!data.thoughtNumber || typeof data.thoughtNumber !== 'number') {
      throw new Error('Invalid thoughtNumber: must be a number');
    }
    if (!data.totalThoughts || typeof data.totalThoughts !== 'number') {
      throw new Error('Invalid totalThoughts: must be a number');
    }
    if (typeof data.nextThoughtNeeded !== 'boolean') {
      throw new Error('Invalid nextThoughtNeeded: must be a boolean');
    }

    return {
      thought: data.thought,
      thoughtNumber: data.thoughtNumber,
      totalThoughts: data.totalThoughts,
      nextThoughtNeeded: data.nextThoughtNeeded,
      isRevision: data.isRevision as boolean | undefined,
      revisesThought: data.revisesThought as number | undefined,
      branchFromThought: data.branchFromThought as number | undefined,
      branchId: data.branchId as string | undefined,
      needsMoreThoughts: data.needsMoreThoughts as boolean | undefined,
    };
  }

  private formatThought(thoughtData: ThoughtData): string {
    const { thoughtNumber, totalThoughts, thought, isRevision, revisesThought, branchFromThought, branchId } = thoughtData;

    let prefix = '';
    let context = '';

    if (isRevision) {
      prefix = chalk.yellow('🔄 Revision');
      context = ` (revising thought ${revisesThought})`;
    } else if (branchFromThought) {
      prefix = chalk.green('🌿 Branch');
      context = ` (from thought ${branchFromThought}, ID: ${branchId})`;
    } else {
      prefix = chalk.blue('💭 Thought');
      context = '';
    }

    const header = `${prefix} ${thoughtNumber}/${totalThoughts}${context}`;
    const border = '─'.repeat(Math.max(header.length, thought.length) + 4);

    return `
┌${border}┐
│ ${header} │
├${border}┤
│ ${thought.padEnd(border.length - 2)} │
└${border}┘`;
  }

  public processThought(input: unknown): { content: Array<{ type: string; text: string }>; isError?: boolean } {
    try {
      logToFile(`Réception d'une requête de pensée: ${JSON.stringify(input)}`);
      const validatedInput = this.validateThoughtData(input);
      logToFile(`Données de pensée validées: ${JSON.stringify(validatedInput)}`);

      if (validatedInput.thoughtNumber > validatedInput.totalThoughts) {
        validatedInput.totalThoughts = validatedInput.thoughtNumber;
      }

      this.thoughtHistory.push(validatedInput);

      if (validatedInput.branchFromThought && validatedInput.branchId) {
        if (!this.branches[validatedInput.branchId]) {
          this.branches[validatedInput.branchId] = [];
        }
        this.branches[validatedInput.branchId].push(validatedInput);
        logToFile(`Ajouté à la branche ${validatedInput.branchId}`);
      }

      const formattedThought = this.formatThought(validatedInput);
      console.error(formattedThought);

      const response = {
        thoughtNumber: validatedInput.thoughtNumber,
        totalThoughts: validatedInput.totalThoughts,
        nextThoughtNeeded: validatedInput.nextThoughtNeeded,
        branches: Object.keys(this.branches),
        thoughtHistoryLength: this.thoughtHistory.length
      };
      
      logToFile(`Envoi de la réponse: ${JSON.stringify(response)}`);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify(response, null, 2)
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logToFile(`ERREUR lors du traitement de la pensée: ${errorMessage}`);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: errorMessage,
            status: 'failed'
          }, null, 2)
        }],
        isError: true
      };
    }
  }
}

const SEQUENTIAL_THINKING_TOOL: Tool = {
  name: "sequentialthinking",
  description: `A detailed tool for dynamic and reflective problem-solving through thoughts.
This tool helps analyze problems through a flexible thinking process that can adapt and evolve.
Each thought can build on, question, or revise previous insights as understanding deepens.

When to use this tool:
- Breaking down complex problems into steps
- Planning and design with room for revision
- Analysis that might need course correction
- Problems where the full scope might not be clear initially
- Problems that require a multi-step solution
- Tasks that need to maintain context over multiple steps
- Situations where irrelevant information needs to be filtered out

Key features:
- You can adjust total_thoughts up or down as you progress
- You can question or revise previous thoughts
- You can add more thoughts even after reaching what seemed like the end
- You can express uncertainty and explore alternative approaches
- Not every thought needs to build linearly - you can branch or backtrack
- Generates a solution hypothesis
- Verifies the hypothesis based on the Chain of Thought steps
- Repeats the process until satisfied
- Provides a correct answer

Parameters explained:
- thought: Your current thinking step, which can include:
* Regular analytical steps
* Revisions of previous thoughts
* Questions about previous decisions
* Realizations about needing more analysis
* Changes in approach
* Hypothesis generation
* Hypothesis verification
- next_thought_needed: True if you need more thinking, even if at what seemed like the end
- thought_number: Current number in sequence (can go beyond initial total if needed)
- total_thoughts: Current estimate of thoughts needed (can be adjusted up/down)
- is_revision: A boolean indicating if this thought revises previous thinking
- revises_thought: If is_revision is true, which thought number is being reconsidered
- branch_from_thought: If branching, which thought number is the branching point
- branch_id: Identifier for the current branch (if any)
- needs_more_thoughts: If reaching end but realizing more thoughts needed

You should:
1. Start with an initial estimate of needed thoughts, but be ready to adjust
2. Feel free to question or revise previous thoughts
3. Don't hesitate to add more thoughts if needed, even at the "end"
4. Express uncertainty when present
5. Mark thoughts that revise previous thinking or branch into new paths
6. Ignore information that is irrelevant to the current step
7. Generate a solution hypothesis when appropriate
8. Verify the hypothesis based on the Chain of Thought steps
9. Repeat the process until satisfied with the solution
10. Provide a single, ideally correct answer as the final output
11. Only set next_thought_needed to false when truly done and a satisfactory answer is reached`,
  inputSchema: {
    type: "object",
    properties: {
      thought: {
        type: "string",
        description: "Your current thinking step"
      },
      nextThoughtNeeded: {
        type: "boolean",
        description: "Whether another thought step is needed"
      },
      thoughtNumber: {
        type: "integer",
        description: "Current thought number",
        minimum: 1
      },
      totalThoughts: {
        type: "integer",
        description: "Estimated total thoughts needed",
        minimum: 1
      },
      isRevision: {
        type: "boolean",
        description: "Whether this revises previous thinking"
      },
      revisesThought: {
        type: "integer",
        description: "Which thought is being reconsidered",
        minimum: 1
      },
      branchFromThought: {
        type: "integer",
        description: "Branching point thought number",
        minimum: 1
      },
      branchId: {
        type: "string",
        description: "Branch identifier"
      },
      needsMoreThoughts: {
        type: "boolean",
        description: "If more thoughts are needed"
      }
    },
    required: ["thought", "nextThoughtNeeded", "thoughtNumber", "totalThoughts"]
  }
};

const server = new Server(
  {
    name: "sequential-thinking-server",
    version: "0.2.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const thinkingServer = new SequentialThinkingServer();

// Ajouter des logs au démarrage du serveur
logToFile("Démarrage du serveur Sequential Thinking MCP");
logToFile(`Version: 0.2.0`);
logToFile(`Répertoire de logs: ${LOGS_DIR}`);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  logToFile("Requête de liste des outils reçue");
  return {
    tools: [SEQUENTIAL_THINKING_TOOL],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  logToFile(`Requête d'appel d'outil reçue: ${JSON.stringify(request)}`);
  // Extraire ou générer un ID pour cette requête
  const requestId = (request as any).id || `req-${Date.now()}`;
  
  if (request.params.name === "sequentialthinking") {
    logToFile(`Traitement de l'outil sequentialthinking avec les arguments: ${JSON.stringify(request.params.arguments)}`);
    const result = thinkingServer.processThought(request.params.arguments);
    
    // Enregistrer l'ID de la requête dans les logs
    if (request.params._meta?.progressToken) {
      logToFile(`Traitement terminé pour la requête avec progressToken: ${request.params._meta.progressToken}`);
    }
    
    // Sauvegarder la réponse dans un fichier avec l'ID de la requête
    saveResponseToFile(requestId, { 
      ...result,
      id: requestId,
      jsonrpc: "2.0",
      params: request.params
    });
    
    return result;
  }

  logToFile(`Outil non pris en charge: ${request.params.name}`);
  throw new Error(`Outil non pris en charge: ${request.params.name}`);
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Sequential Thinking MCP Server running on stdio");
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
