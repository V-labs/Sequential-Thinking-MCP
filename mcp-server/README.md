# Sequential Thinking MCP Server

Un serveur MCP (Model Context Protocol) qui fournit un outil pour la résolution de problèmes dynamique et réflexive à travers un processus de pensée structuré.

## Fonctionnalités

- Décomposer des problèmes complexes en étapes gérables
- Réviser et affiner les réflexions au fur et à mesure que la compréhension s'approfondit
- Explorer des chemins de raisonnement alternatifs
- Ajuster dynamiquement le nombre total de réflexions
- Générer et vérifier des hypothèses de solution

## Outil

### sequential_thinking

Facilite un processus de réflexion détaillé, étape par étape, pour la résolution de problèmes et l'analyse.

**Entrées:**
- `thought` (string): L'étape de réflexion actuelle
- `nextThoughtNeeded` (boolean): Si une autre étape de réflexion est nécessaire
- `thoughtNumber` (integer): Numéro de la réflexion actuelle
- `totalThoughts` (integer): Estimation du nombre total de réflexions nécessaires
- `isRevision` (boolean, optionnel): Si cette réflexion révise une réflexion précédente
- `revisesThought` (integer, optionnel): Quelle réflexion est reconsidérée
- `branchFromThought` (integer, optionnel): Numéro de la réflexion de point de branchement
- `branchId` (string, optionnel): Identifiant de branche
- `needsMoreThoughts` (boolean, optionnel): Si plus de réflexions sont nécessaires

## Utilisation

L'outil Sequential Thinking est conçu pour:
- Décomposer des problèmes complexes en étapes
- Planifier et concevoir avec possibilité de révision
- Analyses qui pourraient nécessiter des corrections de parcours
- Problèmes dont l'étendue complète pourrait ne pas être claire initialement
- Tâches qui doivent maintenir le contexte sur plusieurs étapes
- Situations où les informations non pertinentes doivent être filtrées

## Configuration

### Utilisation avec Claude Desktop

Ajoutez ceci à votre `claude_desktop_config.json`:

#### npx

```json
{
  "mcpServers": {
    "sequential-thinking": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-sequential-thinking"
      ]
    }
  }
}
```

#### docker

```json
{
  "mcpServers": {
    "sequentialthinking": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "mcp/sequentialthinking"
      ]
    }
  }
}
```

## Construction

Docker:

```bash
cd mcp-server
docker build -t mcp/sequentialthinking .
```

## Licence

Ce serveur MCP est sous licence MIT. Cela signifie que vous êtes libre d'utiliser, modifier et distribuer le logiciel, sous réserve des termes et conditions de la licence MIT. 