FROM node:18-alpine

WORKDIR /app

# Installation des dépendances pour mkfifo et curl pour le healthcheck
RUN apk add --no-cache coreutils curl

# Copier les fichiers de l'application
COPY package.json ./
RUN npm install --omit=dev --quiet

# Copier le reste des fichiers
COPY . .

# Créer le répertoire pour les logs
RUN mkdir -p /tmp/mcp-logs && chmod 777 /tmp/mcp-logs

# Exposition du port
EXPOSE 3000

# Démarrer l'application
CMD ["node", "mcp-api.js"] 