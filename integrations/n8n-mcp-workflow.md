# Intégration du serveur MCP avec n8n

Ce document explique comment configurer n8n pour qu'il puisse exécuter et surveiller le serveur MCP Sequential Thinking, avec la possibilité de le relancer automatiquement en cas d'échec.

## Prérequis

- n8n installé et fonctionnel
- Sequential Thinking MCP Server installé via npm ou Docker
- Accès à l'interface d'administration n8n

## Solution de base

### 1. Utiliser le nœud Execute Command pour lancer le serveur MCP

Dans n8n, créez un nouveau workflow et configurez-le comme suit:

#### Étape 1: Déclencheur planifié

Ajoutez un nœud "Schedule Trigger" configuré pour s'exécuter à l'intervalle souhaité (par exemple, toutes les 5 minutes pour vérifier que le serveur est opérationnel).

#### Étape 2: Vérifier si le serveur MCP est en cours d'exécution

Ajoutez un nœud "Execute Command" pour vérifier si le serveur MCP est en cours d'exécution:

```
ps aux | grep -v grep | grep "@modelcontextprotocol/server-sequential-thinking" || echo "NOT_RUNNING"
```

#### Étape 3: Traiter la sortie et décider de relancer

Ajoutez un nœud "IF" pour vérifier si le serveur est arrêté:

- Condition: `{{$node["Execute Command"].json["stdout"].includes("NOT_RUNNING")}}`

#### Étape 4: Relancer le serveur si nécessaire

Si la condition est vraie (serveur arrêté), ajoutez un autre nœud "Execute Command" pour le démarrer:

Pour la version npm:
```
npx @modelcontextprotocol/server-sequential-thinking > /tmp/mcp-server.log 2>&1 &
```

Pour la version Docker:
```
docker run --rm -d -i --name mcp-sequential-thinking mcp/sequentialthinking
```

## Solution avancée avec redirection des entrées/sorties

Pour gérer correctement l'entrée/sortie stdio et pouvoir interagir avec le serveur MCP depuis n8n:

### 1. Créer un script wrapper pour le serveur MCP

Créez un fichier `mcp-wrapper.js`:

```javascript
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const LOGS_DIR = '/tmp/mcp-logs';
const INPUT_FIFO = path.join(LOGS_DIR, 'mcp-input.fifo');
const OUTPUT_LOG = path.join(LOGS_DIR, 'mcp-output.log');
const ERROR_LOG = path.join(LOGS_DIR, 'mcp-error.log');
const PID_FILE = path.join(LOGS_DIR, 'mcp.pid');

// Créer le dossier des logs s'il n'existe pas
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Créer un FIFO pour l'entrée si nécessaire
try {
  if (fs.existsSync(INPUT_FIFO)) {
    fs.unlinkSync(INPUT_FIFO);
  }
  require('child_process').execSync(`mkfifo ${INPUT_FIFO}`);
} catch (err) {
  console.error('Erreur lors de la création du FIFO:', err);
  process.exit(1);
}

// Streams pour les logs
const outputStream = fs.createWriteStream(OUTPUT_LOG, { flags: 'a' });
const errorStream = fs.createWriteStream(ERROR_LOG, { flags: 'a' });

// Démarrer le processus MCP
const mcpProcess = spawn('npx', [
  '@modelcontextprotocol/server-sequential-thinking'
], {
  stdio: ['pipe', 'pipe', 'pipe']
});

// Enregistrer le PID
fs.writeFileSync(PID_FILE, mcpProcess.pid.toString());

// Connecter les streams
const inputStream = fs.createReadStream(INPUT_FIFO);
inputStream.pipe(mcpProcess.stdin);
mcpProcess.stdout.pipe(outputStream);
mcpProcess.stderr.pipe(errorStream);

// Gérer les événements du processus
mcpProcess.on('exit', (code) => {
  console.log(`Processus MCP terminé avec le code: ${code}`);
  
  // Nettoyer les fichiers
  try {
    fs.unlinkSync(INPUT_FIFO);
    fs.unlinkSync(PID_FILE);
  } catch (err) {
    console.error('Erreur lors du nettoyage:', err);
  }
  
  process.exit(code);
});

console.log(`Serveur MCP démarré avec le PID ${mcpProcess.pid}`);
console.log(`Pour envoyer des données: echo '{"request":...}' > ${INPUT_FIFO}`);
```

### 2. Configurer n8n pour gérer ce wrapper

#### a. Nœud pour démarrer le serveur

Utilisez un nœud "Execute Command" pour démarrer le wrapper:

```
node /chemin/vers/mcp-wrapper.js
```

#### b. Nœud pour envoyer des requêtes au serveur

Utilisez un autre nœud "Execute Command" pour envoyer des données au serveur via le FIFO:

```
echo '{"jsonrpc":"2.0","method":"callTool","params":{"name":"sequentialthinking","arguments":{"thought":"Pensée test","thoughtNumber":1,"totalThoughts":1,"nextThoughtNeeded":false}},"id":"1"}' > /tmp/mcp-logs/mcp-input.fifo
```

#### c. Nœud pour lire les réponses du serveur

Utilisez un nœud "Execute Command" pour lire les dernières lignes du fichier de sortie:

```
tail -n 20 /tmp/mcp-logs/mcp-output.log
```

## Surveillance et redémarrage automatique

Pour une solution plus robuste de surveillance et redémarrage automatique, créez un workflow n8n dédié:

1. Déclenché toutes les minutes par un Schedule Trigger
2. Vérifie si le processus est en cours avec `ps aux | grep mcp-wrapper.js | grep -v grep || echo "NOT_RUNNING"`
3. Utilise un nœud IF pour vérifier si le serveur doit être redémarré
4. En cas de redémarrage nécessaire, exécute le script wrapper avec nohup pour le détacher du processus n8n

## Exemple de workflow n8n complet

```json
{
  "nodes": [
    {
      "parameters": {
        "rule": {
          "interval": [
            {
              "field": "minutes",
              "minutesInterval": 5
            }
          ]
        }
      },
      "name": "Schedule Trigger",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1,
      "position": [
        250,
        300
      ]
    },
    {
      "parameters": {
        "command": "ps aux | grep -v grep | grep \"@modelcontextprotocol/server-sequential-thinking\" || echo \"NOT_RUNNING\""
      },
      "name": "Vérifier état du serveur",
      "type": "n8n-nodes-base.executeCommand",
      "typeVersion": 1,
      "position": [
        450,
        300
      ]
    },
    {
      "parameters": {
        "conditions": {
          "string": [
            {
              "value1": "={{$node[\"Vérifier état du serveur\"].json[\"stdout\"]}}",
              "operation": "contains",
              "value2": "NOT_RUNNING"
            }
          ]
        }
      },
      "name": "Serveur en cours?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 1,
      "position": [
        650,
        300
      ]
    },
    {
      "parameters": {
        "command": "nohup node /chemin/vers/mcp-wrapper.js > /tmp/mcp-wrapper.log 2>&1 &"
      },
      "name": "Relancer le serveur",
      "type": "n8n-nodes-base.executeCommand",
      "typeVersion": 1,
      "position": [
        850,
        200
      ]
    }
  ],
  "connections": {
    "Schedule Trigger": {
      "main": [
        [
          {
            "node": "Vérifier état du serveur",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Vérifier état du serveur": {
      "main": [
        [
          {
            "node": "Serveur en cours?",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Serveur en cours?": {
      "main": [
        [
          {
            "node": "Relancer le serveur",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  }
}
```

## Considérations supplémentaires

- Assurez-vous que l'utilisateur exécutant n8n a les permissions nécessaires pour lancer les commandes.
- Utilisez des variables d'environnement n8n pour stocker les chemins et configurations.
- Considérez l'utilisation de pm2 ou supervisord comme alternative plus robuste pour la gestion du processus.
- Pour une configuration en production, utilisez des logs plus détaillés et éventuellement une notification en cas d'échecs répétés du redémarrage. 