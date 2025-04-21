const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const LOGS_DIR = '/tmp/mcp-logs';
const INPUT_FIFO = path.join(LOGS_DIR, 'mcp-input.fifo');
const OUTPUT_LOG = path.join(LOGS_DIR, 'mcp-output.log');
const ERROR_LOG = path.join(LOGS_DIR, 'mcp-error.log');
const PID_FILE = path.join(LOGS_DIR, 'mcp.pid');
const STATUS_FILE = path.join(LOGS_DIR, 'status.json');

// Ajouter une timestamp aux messages de log
function logWithTimestamp(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

// Créer le dossier des logs s'il n'existe pas
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Nettoyer les anciennes instances si nécessaire
function cleanup() {
  try {
    if (fs.existsSync(INPUT_FIFO)) {
      fs.unlinkSync(INPUT_FIFO);
    }
    if (fs.existsSync(PID_FILE)) {
      const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf-8'));
      try {
        process.kill(oldPid, 0); // Vérifier si le processus existe
        logWithTimestamp(`Un ancien processus MCP (PID: ${oldPid}) semble encore actif. Tentative d'arrêt.`);
        process.kill(oldPid, 'SIGTERM');
      } catch (e) {
        // Le processus n'existe probablement plus
      }
      fs.unlinkSync(PID_FILE);
    }
  } catch (err) {
    logWithTimestamp(`Erreur lors du nettoyage des fichiers: ${err.message}`);
  }
}

// Nettoyer au démarrage
cleanup();

// Créer un FIFO pour l'entrée
try {
  require('child_process').execSync(`mkfifo ${INPUT_FIFO}`);
  logWithTimestamp(`FIFO créé pour l'entrée: ${INPUT_FIFO}`);
} catch (err) {
  logWithTimestamp(`Erreur lors de la création du FIFO: ${err.message}`);
  process.exit(1);
}

// Streams pour les logs
const outputStream = fs.createWriteStream(OUTPUT_LOG, { flags: 'a' });
const errorStream = fs.createWriteStream(ERROR_LOG, { flags: 'a' });

// Ajouter une ligne de séparation dans les logs
const separator = '-'.repeat(80) + '\n';
outputStream.write(separator);
errorStream.write(separator);
outputStream.write(`Démarrage du serveur MCP: ${new Date().toISOString()}\n`);
errorStream.write(`Démarrage du serveur MCP: ${new Date().toISOString()}\n`);

// Mettre à jour le fichier de statut
function updateStatus(status, details = {}) {
  const statusData = {
    status,
    timestamp: new Date().toISOString(),
    pid: mcpProcess ? mcpProcess.pid : null,
    ...details
  };
  fs.writeFileSync(STATUS_FILE, JSON.stringify(statusData, null, 2));
}

updateStatus('starting');

// Démarrer le processus MCP
const mcpProcess = spawn('npx', [
  '@modelcontextprotocol/server-sequential-thinking'
], {
  stdio: ['pipe', 'pipe', 'pipe']
});

// Enregistrer le PID
fs.writeFileSync(PID_FILE, mcpProcess.pid.toString());
logWithTimestamp(`Serveur MCP démarré avec le PID ${mcpProcess.pid}`);
updateStatus('running');

// Connecter les streams
const inputStream = fs.createReadStream(INPUT_FIFO);
inputStream.pipe(mcpProcess.stdin);

// Buffer pour analyser les réponses JSON
let outputBuffer = '';

mcpProcess.stdout.on('data', (data) => {
  const text = data.toString();
  outputStream.write(text);
  
  // Ajouter au buffer et chercher des objets JSON complets
  outputBuffer += text;
  try {
    // Essayer de trouver des objets JSON complets
    let jsonStartPos = outputBuffer.indexOf('{');
    while(jsonStartPos !== -1) {
      try {
        const possibleJson = outputBuffer.substring(jsonStartPos);
        const parsed = JSON.parse(possibleJson);
        
        // Si on arrive ici, le JSON est valide - on peut le traiter
        updateStatus('processed_response', {
          lastResponse: parsed
        });
        
        // Supprimer ce JSON du buffer
        outputBuffer = outputBuffer.substring(jsonStartPos + possibleJson.length);
        jsonStartPos = outputBuffer.indexOf('{');
      } catch(e) {
        // JSON incomplet ou malformé, on continue
        jsonStartPos = outputBuffer.indexOf('{', jsonStartPos + 1);
      }
    }
  } catch(e) {
    // Ignorer les erreurs de parsing
  }
});

mcpProcess.stderr.on('data', (data) => {
  errorStream.write(data.toString());
});

// Gérer les événements du processus
mcpProcess.on('exit', (code) => {
  logWithTimestamp(`Processus MCP terminé avec le code: ${code}`);
  updateStatus('exited', { exitCode: code });
  
  // Nettoyer les fichiers
  cleanup();
  
  process.exit(code);
});

// Gérer les signaux pour un arrêt propre
['SIGINT', 'SIGTERM'].forEach(signal => {
  process.on(signal, () => {
    logWithTimestamp(`Signal ${signal} reçu, arrêt propre du serveur MCP...`);
    updateStatus('stopping', { reason: signal });
    mcpProcess.kill();
  });
});

// Afficher les instructions
logWithTimestamp(`Le serveur MCP est prêt à recevoir des commandes.`);
logWithTimestamp(`Pour envoyer une requête: echo '{"jsonrpc":"2.0",...}' > ${INPUT_FIFO}`);
logWithTimestamp(`Les logs de sortie sont disponibles dans: ${OUTPUT_LOG}`);
logWithTimestamp(`Les logs d'erreur sont disponibles dans: ${ERROR_LOG}`); 