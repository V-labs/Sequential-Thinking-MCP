#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema, 
  Tool 
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

// Importation dynamique pour chalk (pour résoudre le problème d'ESM/CommonJS)
const chalkPromise = import('chalk').then(module => module.default);
let chalk: any = { 
  blue: (text: string) => text,
  yellow: (text: string) => text, 
  green: (text: string) => text
};

// Initialiser chalk de manière asynchrone
async function initChalk() {
  chalk = await chalkPromise;
  logToFile('Chalk initialisé avec succès');
}
initChalk().catch(err => logToFile(`Erreur lors de l'initialisation de chalk: ${err}`));

// Configuration
const LOGS_DIR = '/tmp/mcp-logs';
const SERVER_LOG = path.join(LOGS_DIR, 'server-debug.log');
const RESPONSE_DIR = path.join(LOGS_DIR, 'responses');
const STATUS_FILE = path.join(LOGS_DIR, 'daemon-status.json');
const PID_FILE = path.join(LOGS_DIR, 'daemon.pid');
const HTTP_PORT = process.env.MCP_DAEMON_PORT || 3030;

// S'assurer que les répertoires existent
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}
if (!fs.existsSync(RESPONSE_DIR)) {
  fs.mkdirSync(RESPONSE_DIR, { recursive: true });
}

// Enregistrer le PID
fs.writeFileSync(PID_FILE, process.pid.toString());

// Fonction pour écrire dans le fichier de log
function logToFile(message: string): void {
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

// Définition du type ThoughtData
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

// Serveur de pensée séquentielle
class SequentialThinkingServer {
  private thoughtHistory: ThoughtData[] = [];
  private branches: Record<string, ThoughtData[]> = {};
  private requestCounter: number = 0;

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
      this.requestCounter++;
      logToFile(`[Request #${this.requestCounter}] Réception d'une requête de pensée: ${JSON.stringify(input)}`);
      
      const validatedInput = this.validateThoughtData(input);
      logToFile(`[Request #${this.requestCounter}] Données de pensée validées`);

      if (validatedInput.thoughtNumber > validatedInput.totalThoughts) {
        validatedInput.totalThoughts = validatedInput.thoughtNumber;
      }

      this.thoughtHistory.push(validatedInput);

      if (validatedInput.branchFromThought && validatedInput.branchId) {
        if (!this.branches[validatedInput.branchId]) {
          this.branches[validatedInput.branchId] = [];
        }
        this.branches[validatedInput.branchId].push(validatedInput);
        logToFile(`[Request #${this.requestCounter}] Ajouté à la branche ${validatedInput.branchId}`);
      }

      const formattedThought = this.formatThought(validatedInput);
      console.error(formattedThought);

      const response = {
        thoughtNumber: validatedInput.thoughtNumber,
        totalThoughts: validatedInput.totalThoughts,
        nextThoughtNeeded: validatedInput.nextThoughtNeeded,
        branches: Object.keys(this.branches),
        thoughtHistoryLength: this.thoughtHistory.length,
        request: this.requestCounter
      };
      
      logToFile(`[Request #${this.requestCounter}] Envoi de la réponse: ${JSON.stringify(response)}`);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify(response, null, 2)
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logToFile(`[Request #${this.requestCounter}] ERREUR lors du traitement de la pensée: ${errorMessage}`);
      
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

  public getStats(): any {
    return {
      requestsProcessed: this.requestCounter,
      thoughtHistoryLength: this.thoughtHistory.length,
      branches: Object.keys(this.branches).length
    };
  }

  public getThoughtHistorySize(): number {
    return this.thoughtHistory.length;
  }
}

// Définition de l'outil
const SEQUENTIAL_THINKING_TOOL: Tool = {
  name: "sequentialthinking",
  description: `A detailed tool for dynamic and reflective problem-solving through thoughts.
This tool helps analyze problems through a flexible thinking process that can adapt and evolve.
Each thought can build on, question, or revise previous insights as understanding deepens.`,
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

// Initialisation du serveur MCP
const server = new Server(
  {
    name: "sequential-thinking-server-daemon",
    version: "0.3.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Initialisation du serveur de pensée
const thinkingServer = new SequentialThinkingServer();

// Lancement des logs de démarrage
logToFile("Démarrage du serveur Sequential Thinking MCP en mode daemon");
logToFile(`Version: 0.3.0`);
logToFile(`Répertoire de logs: ${LOGS_DIR}`);
logToFile(`Port HTTP: ${HTTP_PORT}`);

// Configuration des handlers du serveur MCP
server.setRequestHandler(ListToolsRequestSchema, async () => {
  logToFile("Requête de liste des outils reçue");
  return {
    tools: [SEQUENTIAL_THINKING_TOOL],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  logToFile(`Requête d'appel d'outil reçue`);
  const requestId = (request as any).id || `req-${Date.now()}`;
  
  if (request.params.name === "sequentialthinking") {
    logToFile(`Traitement de l'outil sequentialthinking pour la requête ${requestId}`);
    const result = thinkingServer.processThought(request.params.arguments);
    
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

// Mise à jour du statut
function updateStatus(status: string) {
  const stats = thinkingServer.getStats();
  const statusData = {
    status: status,
    timestamp: new Date().toISOString(),
    pid: process.pid,
    port: HTTP_PORT,
    stats: stats
  };
  
  fs.writeFileSync(STATUS_FILE, JSON.stringify(statusData, null, 2));
  return statusData;
}

// Initialiser le fichier de statut
updateStatus('starting');

// Créer un serveur HTTP pour recevoir les requêtes JSON-RPC
const httpServer = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    // Gestion des requêtes CORS preflight
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end();
    return;
  }

  // Définir les en-têtes CORS pour toutes les réponses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Route pour le statut
  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(updateStatus('running')));
    return;
  }
  
  // Route pour les détails du statut
  if (req.method === 'GET' && req.url === '/status/details') {
    const statusData = updateStatus('running');
    const detailedStatus = {
      ...statusData,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      logLocation: LOGS_DIR,
      statusFile: STATUS_FILE,
      version: '0.3.0',
      nodeVersion: process.version,
      platform: process.platform,
      thoughtHistorySize: thinkingServer.getThoughtHistorySize()
    };
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(detailedStatus, null, 2));
    return;
  }
  
  // Route pour les requêtes JSON-RPC
  if (req.method === 'POST' && req.url === '/') {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', async () => {
      try {
        const jsonRequest = JSON.parse(body);
        logToFile(`Requête HTTP reçue: ${JSON.stringify(jsonRequest)}`);
        
        if (!jsonRequest.jsonrpc || !jsonRequest.method) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            jsonrpc: '2.0',
            error: { code: -32600, message: 'Format JSON-RPC invalide' },
            id: jsonRequest.id || null
          }));
          return;
        }
        
        // Traitement de la requête
        let result;
        
        if (jsonRequest.method === 'tools/list') {
          // Retourner directement la liste des outils
          result = { tools: [SEQUENTIAL_THINKING_TOOL] };
        } else if (jsonRequest.method === 'tools/call') {
          // Vérifier si l'outil demandé existe
          if (!jsonRequest.params || jsonRequest.params.name !== "sequentialthinking") {
            throw new Error(`Outil non pris en charge: ${jsonRequest.params?.name || 'non spécifié'}`);
          }
          
          // Appel direct à la méthode de traitement
          result = thinkingServer.processThought(jsonRequest.params.arguments);
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            jsonrpc: '2.0',
            error: { code: -32601, message: 'Méthode non supportée' },
            id: jsonRequest.id || null
          }));
          return;
        }
        
        // Préparer la réponse JSON-RPC
        const jsonResponse = {
          jsonrpc: '2.0',
          id: jsonRequest.id || null,
          result: result
        };
        
        // Sauvegarder la réponse pour cette requête
        if (jsonRequest.id) {
          saveResponseToFile(jsonRequest.id, jsonResponse);
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(jsonResponse));
      } catch (error) {
        logToFile(`Erreur lors du traitement de la requête HTTP: ${error}`);
        const errorMessage = error instanceof Error ? error.message : 'Erreur interne du serveur';
        
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: errorMessage
          },
          id: null
        }));
      }
    });
    
    return;
  }
  
  // Route par défaut
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Route non trouvée' }));
});

// Mise en place de la gestion de l'arrêt propre
process.on('SIGINT', () => {
  logToFile('Signal d\'arrêt SIGINT reçu');
  updateStatus('stopping');
  httpServer.close(() => {
    logToFile('Serveur HTTP fermé');
    fs.unlinkSync(PID_FILE);
    updateStatus('stopped');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  logToFile('Signal d\'arrêt SIGTERM reçu');
  updateStatus('stopping');
  httpServer.close(() => {
    logToFile('Serveur HTTP fermé');
    fs.unlinkSync(PID_FILE);
    updateStatus('stopped');
    process.exit(0);
  });
});

// Démarrer le serveur HTTP
httpServer.listen(Number(HTTP_PORT), () => {
  logToFile(`Serveur HTTP démarré sur le port ${HTTP_PORT}`);
  updateStatus('running');
  console.log(`Sequential Thinking MCP Daemon running on http://localhost:${HTTP_PORT}`);
}); 