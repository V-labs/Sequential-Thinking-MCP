# Outils d'intégration pour MCP Sequential Thinking

Ce dossier contient divers outils et exemples pour intégrer le serveur MCP Sequential Thinking avec d'autres systèmes.

## Contenu

### 1. Wrapper JavaScript (`mcp-wrapper.js`)

Un script wrapper simple qui facilite l'interaction avec le serveur MCP en ligne de commande.

**Fonctionnalités :**
- Interface simplifiée pour envoyer des requêtes au serveur MCP
- Gestion de l'entrée/sortie via des pipes pour une utilisation en ligne de commande
- Support pour les requêtes de pensée séquentielle

**Utilisation :**
```bash
node mcp-wrapper.js "Ma pensée actuelle" 1 3 true
```

### 2. Workflows n8n

#### `n8n-mcp-example.json`

Un workflow n8n d'exemple pour interagir directement avec le serveur MCP.

**Fonctionnalités :**
- Démarrage et surveillance du serveur MCP
- Envoi de requêtes et traitement des réponses
- Redémarrage automatique en cas de panne

#### `n8n-mcp-workflow.md`

Documentation détaillée pour configurer et utiliser les workflows n8n avec le serveur MCP.

**Contenu :**
- Instructions pas à pas pour importer le workflow
- Explication des nœuds et de leur configuration
- Conseils de dépannage

## Intégration avec d'autres systèmes

Ces outils peuvent être utilisés comme point de départ pour intégrer le serveur MCP Sequential Thinking avec d'autres systèmes comme :

- Applications web via API REST
- Outils d'automatisation (n8n, Zapier, etc.)
- Chatbots et assistants virtuels
- Scripts personnalisés

Pour une intégration plus robuste avec une API REST complète, consultez le dossier `mcp-api`. 