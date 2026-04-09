# Stage 1: Build the Svelte client
FROM node:20-alpine AS builder

WORKDIR /app/client
COPY client/package.json client/package-lock.json* ./
RUN npm install
COPY client/ ./
RUN npm run build

# Stage 2: Run the server
FROM node:20-alpine

WORKDIR /app
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --production

COPY server/ ./server/
COPY --from=builder /app/client/dist ./client/dist

EXPOSE 3099

CMD ["node", "server/index.js"]
