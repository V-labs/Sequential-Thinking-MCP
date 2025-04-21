# Déploiement du serveur MCP avec n8n sur Coolify

Ce document explique comment déployer le serveur MCP avec n8n sur la plateforme Coolify pour permettre une surveillance et un redémarrage automatiques du serveur.

## Architecture de la solution

La solution comprend:

1. **API MCP** - Un serveur Express qui:
   - Gère le cycle de vie du serveur MCP (démarrage, arrêt, surveillance)
   - Offre des endpoints REST pour interagir avec le serveur MCP
   - Redirige les entrées/sorties via des fichiers FIFO et des logs

2. **n8n** - Une plateforme d'automatisation qui:
   - Surveille l'état du serveur MCP via l'API
   - Redémarre le serveur si nécessaire
   - Expose un webhook pour interagir avec le serveur MCP depuis l'extérieur

## Prérequis

- Un compte Coolify avec accès pour créer des services
- Git pour pousser le code source de l'API
- Accès à n8n (soit installé sur Coolify, soit une instance externe)

## Étape 1: Déployer l'API MCP sur Coolify

1. **Créez un nouveau dépôt Git** avec les fichiers suivants:
   - `mcp-api.js` - Le code source de l'API
   - `package.json` - Les dépendances
   - `Dockerfile` (optionnel, si vous préférez un déploiement Docker personnalisé)

2. **Dans Coolify, créez un nouveau service**:
   - Sélectionnez "Node.js" comme type
   - Connectez à votre dépôt Git
   - Configuration de base:
     - Port d'exposition: 3000
     - Variables d'environnement:
       - `NODE_ENV=production`
       - `PORT=3000`

3. **Configurez un volume persistant**:
   - Ajoutez un volume pour les logs et fichiers FIFO:
     ```
     /tmp/mcp-logs:/tmp/mcp-logs
     ```

4. **Déployez le service**:
   - Cliquez sur "Déployer" dans Coolify
   - Vérifiez les logs pour vous assurer que l'API démarre correctement

## Étape 2: Déployer ou configurer n8n

Si vous n'avez pas encore n8n:

1. **Déployez n8n sur Coolify**:
   - Créez un nouveau service "Docker"
   - Utilisez l'image `n8nio/n8n`
   - Exposez le port 5678
   - Variables d'environnement requises:
     - `N8N_PORT=5678`
     - `N8N_PROTOCOL=http`
     - `N8N_HOST=localhost` (ou votre nom d'hôte)
     - `WEBHOOK_URL=http://votre-domaine-n8n` (URL publique pour les webhooks)

2. **Configurez la résolution de noms pour que n8n puisse communiquer avec l'API MCP**:
   - Option 1: Utilisez le même réseau Docker et le nom du service comme hostname
   - Option 2: Créez un proxy réseau dans Coolify
   - Option 3: Utilisez des URLs publiques avec authentification

## Étape 3: Importer le workflow n8n

1. **Accédez à votre instance n8n**
2. **Cliquez sur "Workflows" puis "Import"**
3. **Importez le fichier `n8n-mcp-api-workflow.json`**
4. **Modifiez les URL dans le workflow**:
   - Remplacez `http://mcp-api:3000` par l'URL de votre API MCP 
   - Par exemple: `http://nom-de-votre-service:3000` ou `https://votre-api-mcp-publique.com`

5. **Activez le workflow**:
   - Cliquez sur "Active" pour démarrer la surveillance

## Étape 4: Tester la solution

1. **Vérifiez que l'API MCP fonctionne**:
   ```
   curl http://votre-api-mcp:3000/api/status
   ```

2. **Démarrez le serveur MCP via l'API**:
   ```
   curl -X POST http://votre-api-mcp:3000/api/start
   ```

3. **Envoyez une requête de test**:
   ```
   curl -X POST http://votre-api-mcp:3000/api/request \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "method": "callTool",
       "params": {
         "name": "sequentialthinking",
         "arguments": {
           "thought": "Test via API",
           "thoughtNumber": 1,
           "totalThoughts": 1,
           "nextThoughtNeeded": false
         }
       },
       "id": "test-1"
     }'
   ```

4. **Vérifiez la réponse**:
   ```
   curl http://votre-api-mcp:3000/api/response/test-1
   ```

## Dépannage

### L'API MCP ne démarre pas

- Vérifiez les logs de déploiement dans Coolify
- Assurez-vous que toutes les dépendances sont correctement installées
- Vérifiez que le volume est correctement monté

### n8n ne peut pas communiquer avec l'API MCP

- Vérifiez que les deux services sont sur le même réseau Docker
- Assurez-vous que les noms d'hôtes sont correctement résolus
- Testez la communication avec un simple ping ou curl

### Le serveur MCP ne démarre pas

- Vérifiez les logs dans `/tmp/mcp-logs/mcp-error.log`
- Assurez-vous que le package `@modelcontextprotocol/server-sequential-thinking` est installé
- Vérifiez les permissions sur le répertoire `/tmp/mcp-logs`

## Endpoints API disponibles

- `GET /api/status` - Obtenir l'état actuel du serveur MCP
- `POST /api/start` - Démarrer le serveur MCP
- `POST /api/stop` - Arrêter le serveur MCP
- `POST /api/request` - Envoyer une requête au serveur MCP
- `GET /api/response/:requestId` - Obtenir la réponse pour une requête spécifique
- `GET /api/logs` - Obtenir les logs (paramètres: type=output|error, lines=50) 