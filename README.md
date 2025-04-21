# Projet Sequential Thinking MCP

Ce projet est composé de deux modules principaux qui fonctionnent ensemble pour fournir une solution complète d'intégration du serveur MCP (Model Context Protocol) avec des outils d'automatisation, spécialement adaptés pour le raisonnement séquentiel.

## À propos du projet

Le serveur MCP (Model Context Protocol) Sequential Thinking permet aux LLMs (Large Language Models) comme Claude d'utiliser un processus de pensée structuré pour résoudre des problèmes complexes. Ce projet propose une implémentation du serveur ainsi que des outils d'intégration qui facilitent son utilisation dans différents contextes (API, automatisation, etc.).

### Cas d'utilisation

- **Résolution de problèmes complexes** : Décomposer des problèmes en étapes plus simples
- **Raisonnement structuré** : Organiser les pensées de manière séquentielle
- **Révision de solutions** : Revoir et améliorer des réflexions précédentes
- **Exploration d'alternatives** : Créer des branches pour explorer différentes solutions
- **Intégration avec des systèmes d'automatisation** : Utiliser n8n ou d'autres outils pour orchestrer des workflows

## Structure du projet

Le projet est organisé en trois dossiers principaux :

### 1. `mcp-server`

Ce dossier contient le serveur MCP (Model Context Protocol) pour le raisonnement séquentiel.

**Fonctionnalités :**
- Implémentation d'un serveur MCP pour le raisonnement séquentiel
- Outil pour décomposer des problèmes complexes en étapes plus simples
- Support pour la révision et le raffinement des raisonnements
- Possibilité de diviser le raisonnement en branches alternatives

**Fichiers principaux :**
- `index.ts` : Point d'entrée du serveur MCP
- `Dockerfile` : Configuration Docker pour le serveur
- `tsconfig.json` : Configuration TypeScript
- `README.md` : Documentation détaillée du serveur MCP

### 2. `mcp-api`

Ce dossier contient une API REST qui sert d'intermédiaire entre le serveur MCP et les outils d'automatisation externes.

**Fonctionnalités :**
- API REST pour contrôler le serveur MCP
- Gestion du cycle de vie du serveur (démarrage, arrêt, surveillance)
- Endpoints pour envoyer des requêtes et récupérer des réponses
- Support pour l'intégration avec n'importe quel système externe

**Fichiers principaux :**
- `mcp-api.js` : Serveur Express qui expose l'API REST
- `Dockerfile` : Configuration Docker pour l'API
- `package.json` : Dépendances et scripts
- `README.md` : Documentation spécifique à l'API

### 3. `integrations`

Ce dossier contient des outils supplémentaires pour faciliter l'intégration du serveur MCP avec différents systèmes comme n8n.

**Contenu :**
- `mcp-wrapper.js` : Script wrapper pour interagir avec le serveur MCP en ligne de commande
- `n8n-mcp-api-workflow.json` : Workflow n8n pour l'intégration avec l'API MCP
- `n8n-mcp-workflow.md` : Documentation pour les workflows n8n
- `README.md` : Guide d'utilisation des outils d'intégration

## Architecture de communication

Le projet fonctionne selon l'architecture suivante :

```
Client/Application <-> mcp-api (REST API) <-> mcp-server (JSON-RPC)
```

Alternative directe via intégrations :

```
Client/Application <-> Intégration (n8n, wrapper, etc.) <-> mcp-api <-> mcp-server
```

## Déploiement

Ce projet peut être déployé de diverses façons selon vos besoins :

### Déploiement Docker Compose

La méthode la plus simple est d'utiliser Docker Compose :

```bash
docker-compose up -d
```

Cette commande démarrera le serveur MCP et l'API, les rendant disponibles sur le port 3000.

Pour plus de détails sur le déploiement, consultez le fichier [DEPLOYMENT.md](DEPLOYMENT.md).

## Test d'intégration

Un script de test d'intégration est disponible pour vérifier que tous les composants fonctionnent correctement ensemble :

```bash
./integration-test.sh
```

Le script supporte différents modes de test :

```bash
# Test simple avec l'API locale
./integration-test.sh

# Test avec une API distante
./integration-test.sh -u https://votre-api.com

# Simuler l'intégration avec n8n
./integration-test.sh -i

# Tests avancés
./integration-test.sh -a
```

## Intégration avec des systèmes externes

Le projet est conçu pour être agnostique et peut être intégré avec n'importe quel système externe capable d'effectuer des requêtes HTTP :

### n8n

Un workflow n8n prêt à l'emploi est disponible dans le dossier `integrations`. Il suffit de l'importer dans votre instance n8n et de configurer l'URL de l'API MCP.

### API REST

Tous les endpoints de l'API MCP sont accessibles via REST, ce qui permet une intégration facile avec n'importe quel système :

- `GET /api/status` - État actuel du serveur
- `POST /api/start` - Démarrer le serveur
- `POST /api/request` - Envoyer une requête au serveur
- `GET /api/response/:id` - Récupérer une réponse spécifique

## Développement

Pour plus d'informations sur le développement et la contribution au projet, consultez la documentation dans chaque dossier.

## Licence

Ce projet est sous licence MIT. Voir le fichier LICENSE pour plus de détails.
