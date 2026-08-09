FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY . .
# Ensure the socket.io client bundle is present in public/ for Express to serve.
# The prepare script runs during `npm install` locally but not during `npm ci`,
# so we run it explicitly here after all source files have been copied.
RUN node scripts/copy-socket-client.js
EXPOSE 8080
ENV NODE_ENV=production
CMD ["node", "server.js"]
