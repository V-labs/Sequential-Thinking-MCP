FROM node:18-alpine AS builder

WORKDIR /app

# Copier les fichiers nécessaires
COPY index.ts ./
COPY tsconfig.json ./
COPY package.json ./

# Installer les dépendances
RUN npm install --save typescript @types/node @modelcontextprotocol/sdk chalk

# Compiler le TypeScript
RUN npx tsc

FROM node:18-alpine AS release

WORKDIR /app

# Copier les fichiers compilés et dépendances
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Installer les dépendances de production
RUN npm install --omit=dev @modelcontextprotocol/sdk chalk

# Définir les variables d'environnement
ENV NODE_ENV=production

# Commande par défaut
ENTRYPOINT ["node", "dist/index.js"]
