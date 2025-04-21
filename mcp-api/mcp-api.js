const express = require('express');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const http = require('http');
const https = require('https');

// Fonction pour faire une requête HTTP avec les modules natifs de Node.js
async function fetchWithHttp(url, options = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const method = options.method || 'GET';
    
    const requestOptions = {
      method,
      headers: options.headers || {},
    };
    
    const req = lib.request(url, requestOptions, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`Statut HTTP: ${res.statusCode}`));
      }
      
      const data = [];
      res.on('data', chunk => {
        data.push(chunk);
      });
      
      res.on('end', () => {
        const body = Buffer.concat(data).toString();
        try {
          const json = JSON.parse(body);
          resolve({ 
            ok: true, 
            status: res.statusCode,
            json: () => Promise.resolve(json),
            text: () => Promise.resolve(body)
          });
        } catch (e) {
          resolve({ 
            ok: true, 
            status: res.statusCode,
            json: () => Promise.reject(new Error('Invalid JSON')),
            text: () => Promise.resolve(body)
          });
        }
      });
    });
    
    req.on('error', (err) => {
      reject(err);
    });
    
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    
    req.end();
  });
}

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
const DAEMON_PID_FILE = path.join(LOGS_DIR, 'daemon.pid');
const STATUS_FILE = path.join(LOGS_DIR, 'status.json');
const RESPONSES_FILE = path.join(LOGS_DIR, 'responses.json');
const DAEMON_HOST = process.env.MCP_DAEMON_HOST || 'localhost';
const DAEMON_PORT = process.env.MCP_DAEMON_PORT || 3030;
const USE_DAEMON = process.env.USE_MCP_DAEMON === 'true';

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

// Fonction pour stocker une réponse
function storeResponse(requestId, response) {
  let responses = {};
  
  // Charger les réponses existantes si le fichier existe
  if (fs.existsSync(RESPONSES_FILE)) {
    try {
      responses = JSON.parse(fs.readFileSync(RESPONSES_FILE, 'utf8'));
    } catch (err) {
      logWithTimestamp(`Erreur lors de la lecture des réponses: ${err.message}`);
      responses = {};
    }
  }
  
  // Ajouter la nouvelle réponse
  responses[requestId] = {
    timestamp: new Date().toISOString(),
    result: response.result || response,
    nextThoughtNeeded: response.params?.arguments?.nextThoughtNeeded !== false
  };
  
  // Sauvegarder le fichier
  fs.writeFileSync(RESPONSES_FILE, JSON.stringify(responses, null, 2));
  logWithTimestamp(`Réponse stockée pour l'ID: ${requestId}`);
  
  return responses[requestId];
}

// Fonction pour récupérer une réponse stockée
function getStoredResponse(requestId) {
  // D'abord vérifier dans le fichier de stockage des réponses
  if (fs.existsSync(RESPONSES_FILE)) {
    try {
      const responses = JSON.parse(fs.readFileSync(RESPONSES_FILE, 'utf8'));
      if (responses[requestId]) {
        logWithTimestamp(`Réponse trouvée dans le fichier de stockage pour l'ID: ${requestId}`);
        return responses[requestId];
      }
    } catch (err) {
      logWithTimestamp(`Erreur lors de la lecture des réponses: ${err.message}`);
    }
  }
  
  // Ensuite, vérifier si une réponse a été écrite par le serveur MCP
  const responseDir = path.join(LOGS_DIR, 'responses');
  const responseFile = path.join(responseDir, `${requestId}.json`);
  
  if (fs.existsSync(responseFile)) {
    try {
      const responseData = JSON.parse(fs.readFileSync(responseFile, 'utf8'));
      logWithTimestamp(`Réponse trouvée dans le fichier de réponse du serveur MCP pour l'ID: ${requestId}`);
      
      // Stocker cette réponse dans notre système pour les futures requêtes
      storeResponse(requestId, responseData);
      
      return responseData;
    } catch (err) {
      logWithTimestamp(`Erreur lors de la lecture du fichier de réponse du serveur MCP: ${err.message}`);
    }
  }
  
  return null;
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

// Fonction pour vérifier si le daemon est en cours d'exécution
function isDaemonRunning() {
  if (fs.existsSync(DAEMON_PID_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(DAEMON_PID_FILE, 'utf-8').trim());
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

// Fonction pour vérifier le statut du daemon via HTTP
async function checkDaemonStatus() {
  try {
    const response = await fetchWithHttp(`http://${DAEMON_HOST}:${DAEMON_PORT}/status`);
    if (response.ok) {
      return await response.json();
    }
    return null;
  } catch (err) {
    logWithTimestamp(`Erreur lors de la vérification du statut du daemon: ${err.message}`);
    return null;
  }
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
      outputStream.write(text);
      logWithTimestamp(`MCP stdout: ${text.trim()}`);
      
      // Rechercher spécifiquement des objets JSON complets
      outputBuffer += text;
      
      // Utiliser une expression régulière pour trouver des objets JSON valides
      const jsonPattern = /\{(?:[^{}]|(?:\{(?:[^{}]|(?:\{[^{}]*\}))*\}))*\}/g;
      const jsonMatches = outputBuffer.match(jsonPattern);
      
      if (jsonMatches) {
        for (const jsonStr of jsonMatches) {
          try {
            const jsonObj = JSON.parse(jsonStr);
            
            // Si l'objet JSON a un ID, c'est une réponse à une requête
            if (jsonObj.id) {
              logWithTimestamp(`Réponse JSON complète détectée pour l'ID: ${jsonObj.id}`);
              storeResponse(jsonObj.id, jsonObj);
              
              // Supprimer ce JSON du buffer
              outputBuffer = outputBuffer.replace(jsonStr, '');
            } 
            // Si l'objet JSON a un résultat sans ID, associer à la dernière requête
            else if (jsonObj.result) {
              try {
                const lastRequestId = fs.readFileSync(path.join(LOGS_DIR, 'last-request-id.txt'), 'utf8').trim();
                if (lastRequestId) {
                  logWithTimestamp(`Réponse JSON sans ID associée à la requête: ${lastRequestId}`);
                  jsonObj.id = lastRequestId; // Ajouter l'ID
                  storeResponse(lastRequestId, jsonObj);
                  
                  // Supprimer ce JSON du buffer
                  outputBuffer = outputBuffer.replace(jsonStr, '');
                }
              } catch (err) {
                logWithTimestamp(`Erreur lors de la lecture du dernier ID de requête: ${err.message}`);
              }
            }
          } catch (err) {
            // JSON invalide, continuer
          }
        }
      }
    });
    
    // Ajouter des logs pour stderr aussi
    mcpProcess.stderr.on('data', (data) => {
      const text = data.toString();
      errorStream.write(text);
      logWithTimestamp(`MCP stderr: ${text.trim()}`);
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
    if (!request.jsonrpc || !request.id) {
      return res.status(400).json({ 
        error: 'Format de requête JSON-RPC invalide. Doit contenir jsonrpc et id' 
      });
    }
    
    // S'assurer que la méthode est correcte
    if (request.method !== 'tools/call') {
      request.method = 'tools/call';
      logWithTimestamp(`Méthode JSON-RPC corrigée à 'tools/call'`);
    }
    
    // Sauvegarder l'ID de la requête actuelle pour référence
    fs.writeFileSync(path.join(LOGS_DIR, 'last-request-id.txt'), request.id);
    
    // Créer une réponse temporaire pour indiquer que la requête est en cours de traitement
    storeResponse(request.id, {
      result: "Requête en cours de traitement...",
      status: "processing"
    });
    
    // Si le mode daemon est activé, on utilise HTTP au lieu de stdio
    if (USE_DAEMON && isDaemonRunning()) {
      logWithTimestamp('Utilisation du serveur MCP en mode daemon');
      
      // Envoyer la requête au daemon via HTTP
      fetchWithHttp(`http://${DAEMON_HOST}:${DAEMON_PORT}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(request)
      })
      .then(response => response.json())
      .then(data => {
        logWithTimestamp(`Réponse du daemon reçue pour ID=${request.id}`);
        storeResponse(request.id, data);
        updateStatus('processed_daemon_response');
      })
      .catch(error => {
        logWithTimestamp(`Erreur lors de la communication avec le daemon: ${error.message}`);
        storeResponse(request.id, {
          result: `Erreur lors de la communication avec le daemon: ${error.message}`,
          status: "error"
        });
      });
      
      // Répondre immédiatement
      return res.json({
        success: true,
        message: 'Requête envoyée au serveur MCP daemon',
        requestId: request.id,
        mode: 'daemon'
      });
    }
    
    // Si le daemon n'est pas utilisé ou n'est pas en cours d'exécution, on utilise le mode stdio standard
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
      
      // Gérer la sortie pour mise à jour du statut et capture des réponses
      let outputBuffer = '';
      mcpProcess.stdout.on('data', (data) => {
        const text = data.toString();
        outputStream.write(text);
        logWithTimestamp(`MCP stdout: ${text.trim()}`);
        
        // Rechercher spécifiquement des objets JSON complets
        outputBuffer += text;
        
        // Utiliser une expression régulière pour trouver des objets JSON valides
        const jsonPattern = /\{(?:[^{}]|(?:\{(?:[^{}]|(?:\{[^{}]*\}))*\}))*\}/g;
        const jsonMatches = outputBuffer.match(jsonPattern);
        
        if (jsonMatches) {
          for (const jsonStr of jsonMatches) {
            try {
              const jsonObj = JSON.parse(jsonStr);
              
              // Si l'objet JSON a un ID, c'est une réponse à une requête
              if (jsonObj.id) {
                logWithTimestamp(`Réponse JSON complète détectée pour l'ID: ${jsonObj.id}`);
                storeResponse(jsonObj.id, jsonObj);
                
                // Supprimer ce JSON du buffer
                outputBuffer = outputBuffer.replace(jsonStr, '');
              } 
              // Si l'objet JSON a un résultat sans ID, associer à la dernière requête
              else if (jsonObj.result) {
                try {
                  const lastRequestId = fs.readFileSync(path.join(LOGS_DIR, 'last-request-id.txt'), 'utf8').trim();
                  if (lastRequestId) {
                    logWithTimestamp(`Réponse JSON sans ID associée à la requête: ${lastRequestId}`);
                    jsonObj.id = lastRequestId; // Ajouter l'ID
                    storeResponse(lastRequestId, jsonObj);
                    
                    // Supprimer ce JSON du buffer
                    outputBuffer = outputBuffer.replace(jsonStr, '');
                  }
                } catch (err) {
                  logWithTimestamp(`Erreur lors de la lecture du dernier ID de requête: ${err.message}`);
                }
              }
            } catch (err) {
              // JSON invalide, continuer
            }
          }
        }
      });
      
      // Ajouter des logs pour stderr aussi
      mcpProcess.stderr.on('data', (data) => {
        const text = data.toString();
        errorStream.write(text);
        logWithTimestamp(`MCP stderr: ${text.trim()}`);
      });
      
      // Gérer la fin du processus
      mcpProcess.on('exit', (code) => {
        logWithTimestamp(`Processus MCP terminé avec le code: ${code}`);
        updateStatus('exited', { exitCode: code });
        
        // Si le code de sortie est 0 (sortie normale), préparer le redémarrage à la prochaine requête
        if (code === 0) {
          logWithTimestamp("Le serveur MCP s'est terminé normalement après avoir traité une requête.");
          
          // Si aucune réponse n'a été capturée, ajouter une réponse par défaut
          const storedResponse = getStoredResponse(request.id);
          if (storedResponse && storedResponse.status === "processing") {
            storeResponse(request.id, {
              result: "Le serveur a traité la requête mais n'a pas produit de réponse JSON-RPC",
              status: "completed"
            });
          }
          
          cleanup();
        } else {
          // En cas d'erreur, nettoyer complètement
          logWithTimestamp(`Le serveur MCP s'est terminé avec une erreur (code ${code}).`);
          
          // Mettre à jour la réponse avec l'erreur
          storeResponse(request.id, {
            result: `Le serveur MCP s'est terminé avec une erreur (code ${code})`,
            status: "error"
          });
          
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
          const jsonRequest = JSON.stringify(request, null, 2);
          logWithTimestamp(`Envoi de la requête: ${jsonRequest}`);
          fs.writeFileSync(INPUT_FIFO, jsonRequest);
          logWithTimestamp(`Requête envoyée: ID=${request.id}`);
          
          res.json({ 
            success: true, 
            message: 'Serveur MCP démarré et requête envoyée',
            requestId: request.id
          });
        } catch (error) {
          logWithTimestamp(`Erreur lors de l'envoi de la requête: ${error.message}`);
          res.status(500).json({ error: `Erreur lors de l'envoi de la requête: ${error.message}` });
        }
      }, 1000);
      
      return;
    }
    
    // Écrire dans le FIFO si le serveur est déjà en cours d'exécution
    try {
      const jsonRequest = JSON.stringify(request, null, 2);
      logWithTimestamp(`Envoi de la requête: ${jsonRequest}`);
      fs.writeFileSync(INPUT_FIFO, jsonRequest);
      logWithTimestamp(`Requête envoyée: ID=${request.id}`);
      
      res.json({ 
        success: true, 
        message: 'Requête envoyée au serveur MCP',
        requestId: request.id
      });
    } catch (error) {
      logWithTimestamp(`Erreur lors de l'envoi de la requête: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint pour obtenir la réponse à une requête spécifique
app.get('/api/response/:requestId', (req, res) => {
  try {
    const requestId = req.params.requestId;
    
    // Vérifier d'abord si une réponse est stockée
    const storedResponse = getStoredResponse(requestId);
    if (storedResponse) {
      if (storedResponse.status === "processing") {
        return res.json({
          status: "processing",
          message: "La requête est en cours de traitement"
        });
      }
      
      return res.json({
        status: "completed",
        result: storedResponse.result,
        nextThoughtNeeded: storedResponse.nextThoughtNeeded
      });
    }
    
    // Si aucune réponse n'est stockée, rechercher dans les logs comme avant
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
            
            // Stocker la réponse pour les futures requêtes
            storeResponse(requestId, jsonObj);
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
        status: "completed",
        result: response.result,
        nextThoughtNeeded: response.params?.arguments?.nextThoughtNeeded !== false
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

// Endpoint pour vider le stockage des réponses (utile pour les tests)
app.post('/api/clear-responses', (req, res) => {
  try {
    if (fs.existsSync(RESPONSES_FILE)) {
      fs.unlinkSync(RESPONSES_FILE);
      logWithTimestamp('Fichier de réponses supprimé');
    }
    fs.writeFileSync(RESPONSES_FILE, '{}');
    
    res.json({
      success: true,
      message: 'Stockage des réponses vidé'
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
  
  // Initialiser le fichier de réponses s'il n'existe pas
  if (!fs.existsSync(RESPONSES_FILE)) {
    fs.writeFileSync(RESPONSES_FILE, '{}');
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