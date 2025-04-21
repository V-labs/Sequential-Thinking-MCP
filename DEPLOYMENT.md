# Déploiement du serveur MCP et intégration avec des systèmes externes

Ce document explique comment déployer le serveur MCP avec son API et l'intégrer avec des systèmes externes comme n8n, permettant une surveillance et un redémarrage automatiques du serveur.

## Architecture de la solution

La solution comprend:

1. **API MCP** - Un serveur Express qui:
   - Gère le cycle de vie du serveur MCP (démarrage, arrêt, surveillance)
   - Offre des endpoints REST pour interagir avec le serveur MCP
   - Redirige les entrées/sorties via des fichiers FIFO et des logs

2. **Serveur MCP** - Le serveur Model Context Protocol pour le raisonnement séquentiel.

3. **Système d'intégration** (Optionnel, par exemple n8n) - Une plateforme d'automatisation qui:
   - Surveille l'état du serveur MCP via l'API
   - Redémarre le serveur si nécessaire
   - Expose des webhooks pour interagir avec le serveur MCP depuis l'extérieur

## Prérequis

- Docker et Docker Compose
- Git pour gérer le code source
- Un système d'intégration (optionnel, ex: n8n, Zapier, etc.)

## Étape 1: Installation

1. **Clonez ce projet**:
   ```bash
   git clone https://your-repo-url/sequential-thinking-mcp.git
   cd sequential-thinking-mcp
   ```

2. **Lancez les services avec Docker Compose**:
   ```bash
   docker-compose up -d
   ```

   Cette commande démarrera:
   - Le serveur MCP pour le raisonnement séquentiel
   - L'API REST pour interagir avec le serveur MCP

## Étape 2: Vérifier le déploiement

1. **Vérifiez que les conteneurs sont en cours d'exécution**:
   ```bash
   docker-compose ps
   ```

2. **Vérifiez que l'API MCP fonctionne**:
   ```bash
   curl http://localhost:3000/api/status
   ```

   Vous devriez recevoir une réponse JSON avec l'état actuel du serveur.

## Étape 3: Intégration avec n8n (optionnel)

Si vous souhaitez intégrer la solution avec n8n:

1. **Déployez n8n** (si ce n'est pas déjà fait)

2. **Importez le workflow**:
   - Allez dans "Workflows" puis "Import"
   - Importez le fichier `integrations/n8n-mcp-api-workflow.json`

3. **Configurez l'URL de l'API MCP dans le nœud "Configuration MCP"**:
   - Remplacez `https://mcp-api.coolify.example.com` par l'URL de votre API MCP
   - Par exemple: `http://localhost:3000` pour un déploiement local

4. **Si vous utilisez Slack pour les notifications**:
   - Remplacez `YOUR_SLACK_WEBHOOK_ID` par l'ID de votre webhook Slack

5. **Activez le workflow**:
   - Cliquez sur le bouton "Active" pour activer le workflow

## Étape 4: Tester l'intégration

1. **Vérifiez que l'API MCP fonctionne**:
   ```bash
   curl http://localhost:3000/api/status
   ```

2. **Testez un appel via le webhook n8n** (si configuré):
   ```bash
   curl -X POST http://your-n8n-host:5678/webhook/mcp/sequentialthinking \
     -H "Content-Type: application/json" \
     -d '{
       "thought": "Test de l'\''API MCP via n8n",
       "thoughtNumber": 1,
       "totalThoughts": 1,
       "nextThoughtNeeded": false
     }'
   ```

3. **Ou testez directement l'API MCP**:
   ```bash
   curl -X POST http://localhost:3000/api/request \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "method": "callTool",
       "params": {
         "name": "sequentialthinking",
         "arguments": {
           "thought": "Test direct de l'\''API MCP",
           "thoughtNumber": 1,
           "totalThoughts": 1,
           "nextThoughtNeeded": false
         }
       },
       "id": "test-1234"
     }'
   ```

## Configuration réseau

Si l'API MCP et les systèmes externes ne sont pas sur le même réseau:

1. **Assurez-vous que les ports sont correctement exposés**:
   - Le port 3000 est exposé par défaut dans le docker-compose.yml
   - Modifiez ce port si nécessaire

2. **Configurez les paramètres CORS si nécessaire**:
   - Par défaut, CORS est configuré pour accepter les requêtes de n'importe quelle origine
   - Ajustez la variable d'environnement `CORS_ALLOW_ORIGIN` pour restreindre les origines autorisées

## Surveillance et maintenance

### Surveillance automatique

Si vous utilisez n8n avec le workflow fourni, il effectuera:
- Une vérification périodique toutes les 5 minutes
- Un healthcheck toutes les 30 minutes
- Un redémarrage automatique en cas de problème détecté

### Logs

Les logs sont disponibles:
- Via Docker: `docker-compose logs -f`
- Via l'API à l'endpoint `/api/logs`
- Dans le volume monté à `/tmp/mcp-logs`

### Endpoints API disponibles

- `GET /api/status` - Obtenir l'état actuel du serveur MCP
- `POST /api/start` - Démarrer le serveur MCP
- `POST /api/stop` - Arrêter le serveur MCP
- `POST /api/request` - Envoyer une requête au serveur MCP
- `GET /api/response/:requestId` - Obtenir la réponse pour une requête spécifique
- `GET /api/logs` - Obtenir les logs (paramètres: type=output|error, lines=50)

## Dépannage

### L'API MCP ne démarre pas

- Vérifiez les logs Docker: `docker-compose logs mcp-api`
- Assurez-vous que toutes les dépendances sont correctement installées
- Vérifiez que le volume est correctement monté

### Le système d'intégration ne peut pas communiquer avec l'API MCP

- Vérifiez que l'URL de l'API est correctement configurée dans votre système d'intégration
- Testez l'accès à l'API depuis l'extérieur avec curl
- Vérifiez les règles de CORS si nécessaire

### Le serveur MCP ne démarre pas

- Vérifiez les logs Docker: `docker-compose logs mcp-server`
- Vérifiez les logs via l'API: `curl http://localhost:3000/api/logs?type=error`
- Assurez-vous que le package `@modelcontextprotocol/server-sequential-thinking` est installé
- Vérifiez les permissions sur le volume partagé

## Déploiement avec Coolify

[Coolify](https://coolify.io/) est une alternative open-source auto-hébergée à Netlify, Vercel et Heroku qui peut être utilisée pour déployer le serveur MCP facilement.

### Étape 1: Installer Coolify

Suivez les instructions d'installation sur le [site officiel de Coolify](https://coolify.io/docs/installation).

### Étape 2: Configurer le projet

1. **Connectez votre dépôt Git à Coolify**:
   - Dans l'interface de Coolify, allez dans "Sources" et ajoutez votre dépôt Git.

2. **Créez deux services séparés**:
   - **Service 1: API MCP**
     - Sélectionnez le dossier `mcp-api`
     - Type: Docker
     - Utilisez le Dockerfile présent dans le dossier
     - Exposez le port 3000

   - **Service 2: MCP Server**
     - Sélectionnez le dossier `mcp-server`
     - Type: Docker
     - Utilisez le Dockerfile présent dans le dossier
     - Aucun port à exposer (communication interne uniquement)

3. **Configurez les ressources**:
   - Attribuez suffisamment de RAM et de CPU à chaque service
   - Recommandation: au moins 1GB de RAM pour chaque service

4. **Volumes persistants**:
   - Créez un volume pour `/tmp/mcp-logs` partagé entre les deux services

### Étape 3: Variables d'environnement

Configurez les variables d'environnement suivantes pour l'API MCP:

```
NODE_ENV=production
PORT=3000
CORS_ALLOW_ORIGIN=* # Ou restreignez selon vos besoins
```

### Étape 4: Mise en réseau

1. **Créez un réseau privé** entre les deux services pour qu'ils puissent communiquer.
2. **Configurez un domaine personnalisé** pour l'API MCP si nécessaire.

### Étape 5: Déploiement

1. **Déployez d'abord le serveur MCP**, puis l'API MCP.
2. **Vérifiez les logs** pour vous assurer que tout fonctionne correctement.

### Étape 6: Intégration et tests

Suivez les étapes d'intégration et de tests mentionnées précédemment, en utilisant l'URL fournie par Coolify pour votre API MCP.

### Dépannage spécifique à Coolify

- **Problèmes de connexion entre services**: Assurez-vous que les services sont sur le même réseau Coolify.
- **Problèmes de volumes**: Vérifiez que les volumes sont correctement montés et accessibles par les conteneurs.
- **Problèmes de mémoire**: Si un service redémarre fréquemment, augmentez l'allocation de mémoire. 