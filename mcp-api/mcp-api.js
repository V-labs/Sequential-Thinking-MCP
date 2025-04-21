const express = require('express');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 3000;

// Configuration
const LOGS_DIR = '/tmp/mcp-logs';
const INPUT_FIFO = path.join(LOGS_DIR, 'mcp-input.fifo');
const OUTPUT_LOG = path.join(LOGS_DIR, 'mcp-output.log');
const ERROR_LOG = path.join(LOGS_DIR, 'mcp-error.log');
const PID_FILE = path.join(LOGS_DIR, 'mcp.pid');
const STATUS_FILE = path.join(LOGS_DIR, 'status.json');

// Fonctions utilitaires
function logWithTimestamp(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

// Assurer que le répertoire existe
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  logWithTimestamp(`Répertoire créé: ${LOGS_DIR}`);
}

// Vérifier si le serveur MCP est en cours d'exécution
function isServerRunning() {
  if (fs.existsSync(PID_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim());
      try {
        process.kill(pid, 0); // Signal 0 vérifie juste si le processus existe
        return true;
      } catch (e) {
        return false; // Processus n'existe pas
      }
    } catch (err) {
      return false;
    }
  }
  return false;
}

// Mettre à jour le statut
function updateStatus(status, details = {}) {
  const statusData = {
    status,
    timestamp: new Date().toISOString(),
    ...details
  };
  
  if (fs.existsSync(PID_FILE)) {
    try {
      statusData.pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim());
    } catch (e) {
      // Ignorer les erreurs de lecture du PID
    }
  }
  
  fs.writeFileSync(STATUS_FILE, JSON.stringify(statusData, null, 2));
  return statusData;
}

// Nettoyer les anciennes instances
function cleanup() {
  try {
    if (fs.existsSync(INPUT_FIFO)) {
      fs.unlinkSync(INPUT_FIFO);
      logWithTimestamp(`FIFO supprimé: ${INPUT_FIFO}`);
    }
    if (fs.existsSync(PID_FILE)) {
      const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim());
      try {
        process.kill(oldPid, 0); // Vérifier si le processus existe
        logWithTimestamp(`Un ancien processus MCP (PID: ${oldPid}) semble encore actif. Tentative d'arrêt.`);
        process.kill(oldPid, 'SIGTERM');
      } catch (e) {
        // Le processus n'existe probablement plus
      }
      fs.unlinkSync(PID_FILE);
      logWithTimestamp(`Fichier PID supprimé: ${PID_FILE}`);
    }
  } catch (err) {
    logWithTimestamp(`Erreur lors du nettoyage: ${err.message}`);
  }
}

// API endpoints

// Endpoint pour obtenir le statut actuel
app.get('/api/status', (req, res) => {
  try {
    const running = isServerRunning();
    let status;
    
    if (fs.existsSync(STATUS_FILE)) {
      status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
      // Mise à jour du statut en fonction de la vérification du processus
      if (running && status.status !== 'running') {
        status = updateStatus('running');
      } else if (!running && status.status === 'running') {
        status = updateStatus('stopped');
      }
    } else {
      status = updateStatus('not_configured');
    }
    
    res.json({
      ...status,
      isRunning: running
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint pour démarrer le serveur MCP
app.post('/api/start', (req, res) => {
  try {
    if (isServerRunning()) {
      return res.json({ 
        success: true, 
        message: 'Le serveur MCP est déjà en cours d\'exécution',
        status: JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'))
      });
    }
    
    // Nettoyer avant de démarrer
    cleanup();
    
    // Créer le FIFO
    try {
      execSync(`mkfifo ${INPUT_FIFO}`);
      logWithTimestamp(`FIFO créé: ${INPUT_FIFO}`);
    } catch (error) {
      logWithTimestamp(`Erreur en créant le FIFO: ${error.message}`);
      return res.status(500).json({ error: `Erreur lors de la création du FIFO: ${error.message}` });
    }
    
    // Créer/préparer les fichiers de log
    const outputStream = fs.createWriteStream(OUTPUT_LOG, { flags: 'a' });
    const errorStream = fs.createWriteStream(ERROR_LOG, { flags: 'a' });
    const separator = '-'.repeat(80) + '\n';
    outputStream.write(separator);
    errorStream.write(separator);
    outputStream.write(`Démarrage du serveur MCP: ${new Date().toISOString()}\n`);
    errorStream.write(`Démarrage du serveur MCP: ${new Date().toISOString()}\n`);
    
    // Mettre à jour le statut
    updateStatus('starting');
    
    // Démarrer le processus MCP en arrière-plan
    const mcpProcess = spawn('npx', [
      '@modelcontextprotocol/server-sequential-thinking'
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true
    });
    
    // Enregistrer le PID
    fs.writeFileSync(PID_FILE, mcpProcess.pid.toString());
    logWithTimestamp(`Serveur MCP démarré avec le PID ${mcpProcess.pid}`);
    
    // Connecter les streams
    const inputStream = fs.createReadStream(INPUT_FIFO);
    inputStream.pipe(mcpProcess.stdin);
    mcpProcess.stdout.pipe(outputStream);
    mcpProcess.stderr.pipe(errorStream);
    
    // Gérer la sortie pour mise à jour du statut
    let outputBuffer = '';
    mcpProcess.stdout.on('data', (data) => {
      const text = data.toString();
      
      // Chercher des objets JSON complets
      outputBuffer += text;
      try {
        let jsonStartPos = outputBuffer.indexOf('{');
        while(jsonStartPos !== -1) {
          try {
            const possibleJson = outputBuffer.substring(jsonStartPos);
            JSON.parse(possibleJson);
            
            updateStatus('processed_response');
            
            // Supprimer ce JSON du buffer
            outputBuffer = outputBuffer.substring(jsonStartPos + possibleJson.length);
            jsonStartPos = outputBuffer.indexOf('{');
          } catch(e) {
            // JSON incomplet ou malformé
            jsonStartPos = outputBuffer.indexOf('{', jsonStartPos + 1);
          }
        }
      } catch(e) {
        // Ignorer les erreurs de parsing
      }
    });
    
    // Gérer la fin du processus
    mcpProcess.on('exit', (code) => {
      logWithTimestamp(`Processus MCP terminé avec le code: ${code}`);
      updateStatus('exited', { exitCode: code });
      
      // Si le code de sortie est 0 (sortie normale), préparer le redémarrage à la prochaine requête
      if (code === 0) {
        logWithTimestamp("Le serveur MCP s'est terminé normalement après avoir traité une requête.");
        cleanup();
      } else {
        // En cas d'erreur, nettoyer complètement
        logWithTimestamp(`Le serveur MCP s'est terminé avec une erreur (code ${code}).`);
        cleanup();
      }
    });
    
    // Ne pas attendre la fin du processus
    mcpProcess.unref();
    
    // Mise à jour finale du statut
    const statusData = updateStatus('running', { pid: mcpProcess.pid });
    
    // Répondre avec succès
    res.json({ 
      success: true, 
      message: 'Serveur MCP démarré', 
      pid: mcpProcess.pid,
      status: statusData
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint pour arrêter le serveur MCP
app.post('/api/stop', (req, res) => {
  try {
    if (!isServerRunning()) {
      return res.json({ 
        success: true, 
        message: 'Le serveur MCP n\'est pas en cours d\'exécution'
      });
    }
    
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim());
    process.kill(pid, 'SIGTERM');
    
    updateStatus('stopping', { reason: 'API request' });
    
    res.json({ 
      success: true, 
      message: 'Signal d\'arrêt envoyé au serveur MCP', 
      pid: pid
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint pour envoyer une requête au serveur MCP
app.post('/api/request', (req, res) => {
  try {
    const request = req.body;
    
    // Valider la requête de base
    if (!request.jsonrpc || !request.method || !request.id) {
      return res.status(400).json({ 
        error: 'Format de requête JSON-RPC invalide. Doit contenir jsonrpc, method et id' 
      });
    }
    
    // Vérifier si le serveur est en cours d'exécution et le démarrer si nécessaire
    if (!isServerRunning()) {
      logWithTimestamp('Le serveur MCP n\'est pas en cours d\'exécution. Démarrage automatique...');
      
      // Nettoyer avant de démarrer
      cleanup();
      
      // Créer le FIFO
      try {
        execSync(`mkfifo ${INPUT_FIFO}`);
        logWithTimestamp(`FIFO créé: ${INPUT_FIFO}`);
      } catch (error) {
        logWithTimestamp(`Erreur en créant le FIFO: ${error.message}`);
        return res.status(500).json({ error: `Erreur lors de la création du FIFO: ${error.message}` });
      }
      
      // Créer/préparer les fichiers de log
      const outputStream = fs.createWriteStream(OUTPUT_LOG, { flags: 'a' });
      const errorStream = fs.createWriteStream(ERROR_LOG, { flags: 'a' });
      const separator = '-'.repeat(80) + '\n';
      outputStream.write(separator);
      errorStream.write(separator);
      outputStream.write(`Démarrage du serveur MCP: ${new Date().toISOString()}\n`);
      errorStream.write(`Démarrage du serveur MCP: ${new Date().toISOString()}\n`);
      
      // Mettre à jour le statut
      updateStatus('starting');
      
      // Démarrer le processus MCP en arrière-plan
      const mcpProcess = spawn('npx', [
        '@modelcontextprotocol/server-sequential-thinking'
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true
      });
      
      // Enregistrer le PID
      fs.writeFileSync(PID_FILE, mcpProcess.pid.toString());
      logWithTimestamp(`Serveur MCP démarré avec le PID ${mcpProcess.pid}`);
      
      // Connecter les streams
      const inputStream = fs.createReadStream(INPUT_FIFO);
      inputStream.pipe(mcpProcess.stdin);
      mcpProcess.stdout.pipe(outputStream);
      mcpProcess.stderr.pipe(errorStream);
      
      // Gérer la sortie pour mise à jour du statut
      let outputBuffer = '';
      mcpProcess.stdout.on('data', (data) => {
        const text = data.toString();
        
        // Chercher des objets JSON complets
        outputBuffer += text;
        try {
          let jsonStartPos = outputBuffer.indexOf('{');
          while(jsonStartPos !== -1) {
            try {
              const possibleJson = outputBuffer.substring(jsonStartPos);
              JSON.parse(possibleJson);
              
              updateStatus('processed_response');
              
              // Supprimer ce JSON du buffer
              outputBuffer = outputBuffer.substring(jsonStartPos + possibleJson.length);
              jsonStartPos = outputBuffer.indexOf('{');
            } catch(e) {
              // JSON incomplet ou malformé
              jsonStartPos = outputBuffer.indexOf('{', jsonStartPos + 1);
            }
          }
        } catch(e) {
          // Ignorer les erreurs de parsing
        }
      });
      
      // Gérer la fin du processus
      mcpProcess.on('exit', (code) => {
        logWithTimestamp(`Processus MCP terminé avec le code: ${code}`);
        updateStatus('exited', { exitCode: code });
        
        // Si le code de sortie est 0 (sortie normale), préparer le redémarrage à la prochaine requête
        if (code === 0) {
          logWithTimestamp("Le serveur MCP s'est terminé normalement après avoir traité une requête.");
          cleanup();
        } else {
          // En cas d'erreur, nettoyer complètement
          logWithTimestamp(`Le serveur MCP s'est terminé avec une erreur (code ${code}).`);
          cleanup();
        }
      });
      
      // Ne pas attendre la fin du processus
      mcpProcess.unref();
      
      // Mise à jour finale du statut
      updateStatus('running', { pid: mcpProcess.pid });
      
      // Attendre un peu pour s'assurer que le serveur est prêt
      setTimeout(() => {
        // Écrire dans le FIFO
        try {
          fs.writeFileSync(INPUT_FIFO, JSON.stringify(request));
          logWithTimestamp(`Requête envoyée: ID=${request.id}`);
          
          res.json({ 
            success: true, 
            message: 'Serveur MCP démarré et requête envoyée',
            requestId: request.id
          });
        } catch (error) {
          res.status(500).json({ error: `Erreur lors de l'envoi de la requête: ${error.message}` });
        }
      }, 1000);
      
      return;
    }
    
    // Écrire dans le FIFO si le serveur est déjà en cours d'exécution
    fs.writeFileSync(INPUT_FIFO, JSON.stringify(request));
    logWithTimestamp(`Requête envoyée: ID=${request.id}`);
    
    res.json({ 
      success: true, 
      message: 'Requête envoyée au serveur MCP',
      requestId: request.id
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint pour obtenir la réponse à une requête spécifique
app.get('/api/response/:requestId', (req, res) => {
  try {
    const requestId = req.params.requestId;
    const tailLines = req.query.lines || 100;
    
    if (!fs.existsSync(OUTPUT_LOG)) {
      return res.status(404).json({ error: 'Fichier de log non trouvé' });
    }
    
    // Lire les dernières lignes du log
    const output = execSync(`tail -n ${tailLines} ${OUTPUT_LOG}`).toString();
    
    // Rechercher la réponse avec l'ID correspondant
    let response = null;
    
    // Chercher des objets JSON complets dans la sortie
    let startPos = 0;
    while (startPos < output.length) {
      const jsonStart = output.indexOf('{', startPos);
      if (jsonStart === -1) break;
      
      try {
        // Essayer d'extraire et parser un JSON
        let braceCount = 1;
        let endPos = jsonStart + 1;
        
        while (braceCount > 0 && endPos < output.length) {
          if (output[endPos] === '{') braceCount++;
          else if (output[endPos] === '}') braceCount--;
          endPos++;
        }
        
        if (braceCount === 0) {
          const jsonStr = output.substring(jsonStart, endPos);
          const jsonObj = JSON.parse(jsonStr);
          
          // Vérifier si l'ID correspond
          if (jsonObj.id === requestId) {
            response = jsonObj;
            break;
          }
        }
        
        startPos = endPos;
      } catch (e) {
        // Passer au caractère suivant en cas d'erreur
        startPos = jsonStart + 1;
      }
    }
    
    if (response) {
      res.json({
        success: true,
        response: response
      });
    } else {
      res.status(404).json({
        error: `Aucune réponse trouvée pour l'ID de requête: ${requestId}`,
        output: output.slice(-500) // Retourner les 500 derniers caractères pour le débogage
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint pour lire les logs
app.get('/api/logs', (req, res) => {
  try {
    const type = req.query.type || 'output';
    const lines = parseInt(req.query.lines || 50);
    
    const logFile = type === 'error' ? ERROR_LOG : OUTPUT_LOG;
    
    if (!fs.existsSync(logFile)) {
      return res.status(404).json({ error: `Fichier de log ${type} non trouvé` });
    }
    
    const output = execSync(`tail -n ${lines} ${logFile}`).toString();
    
    res.json({
      type: type,
      lines: lines,
      logs: output
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Démarrer le serveur
app.listen(PORT, () => {
  logWithTimestamp(`API MCP démarrée sur le port ${PORT}`);
  
  // Initialiser le fichier de statut s'il n'existe pas
  if (!fs.existsSync(STATUS_FILE)) {
    updateStatus('initialized');
  }
});

// Gérer l'arrêt propre
process.on('SIGINT', () => {
  logWithTimestamp('Signal d\'arrêt reçu, nettoyage...');
  if (isServerRunning()) {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim());
    try {
      process.kill(pid, 'SIGTERM');
      logWithTimestamp(`Signal d'arrêt envoyé au serveur MCP (PID: ${pid})`);
    } catch (e) {
      // Ignorer
    }
  }
  process.exit(0);
}); 