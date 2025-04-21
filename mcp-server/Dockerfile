FROM node:18-alpine AS builder

WORKDIR /app

# Copier les fichiers nécessaires
COPY index.ts ./
COPY daemon.ts ./
COPY tsconfig.json ./
COPY package.json ./

# Installer les dépendances
RUN npm install --save typescript @types/node ts-node @modelcontextprotocol/sdk chalk

# Compiler le TypeScript
RUN npx tsc

FROM node:18-alpine AS release

WORKDIR /app

# Copier les fichiers compilés et dépendances
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

# Exposer le port pour le mode daemon
EXPOSE 3030

# Définir les variables d'environnement
ENV NODE_ENV=production
ENV MCP_DAEMON_PORT=3030

# Créer le répertoire pour les logs
RUN mkdir -p /tmp/mcp-logs && chmod 777 /tmp/mcp-logs

# Utilisation de CMD pour permettre l'override dans docker-compose
CMD ["node", "dist/index.js"]
