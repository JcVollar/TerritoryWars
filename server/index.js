const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const Game = require('./game');
const BotManager = require('./bot');

// --- Serve static files ---
const STATIC_DIR = path.join(__dirname, '..', 'client', 'dist');

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  // Remove query strings
  filePath = filePath.split('?')[0];
  const fullPath = path.join(STATIC_DIR, filePath);

  // Prevent directory traversal
  if (!fullPath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(fullPath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      // Fall back to index.html for SPA routing
      fs.readFile(path.join(STATIC_DIR, 'index.html'), (err2, data2) => {
        if (err2) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data2);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// --- Game setup ---
const game = new Game();
const botManager = new BotManager(game);
botManager.spawnInitialBots();

// --- HTTP + WebSocket server ---
const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server });

// Client connections: ws -> { playerId, inLobby }
const clients = new Map();

wss.on('connection', (ws) => {
  const clientState = { playerId: null, inLobby: true, spectating: false, needsFullGrid: true };
  clients.set(ws, clientState);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'join': {
        const name = (msg.name || 'Anon').substring(0, 16);

        if (game.getTotalClaimedPct() >= config.MAX_TERRITORY_PCT) {
          ws.send(JSON.stringify({ type: 'lobby', reason: 'Map is too full. Waiting for space...' }));
          clientState.inLobby = true;
          return;
        }

        const player = game.spawnPlayer(name, false);
        if (!player) {
          ws.send(JSON.stringify({ type: 'lobby', reason: 'Map is too full. Waiting for space...' }));
          clientState.inLobby = true;
          return;
        }

        clientState.playerId = player.id;
        clientState.inLobby = false;
        ws.send(JSON.stringify({
          type: 'joined',
          playerId: player.id,
          config: {
            GRID_W: config.GRID_W,
            GRID_H: config.GRID_H,
            SQUARE_PX: config.SQUARE_PX,
          },
        }));
        break;
      }

      case 'dir': {
        if (clientState.playerId && !clientState.inLobby) {
          game.setDirection(clientState.playerId, msg.dir);
        }
        break;
      }

      case 'spectate': {
        clientState.spectating = true;
        clientState.inLobby = false;
        clientState.playerId = null;
        ws.send(JSON.stringify({
          type: 'spectating',
          config: {
            GRID_W: config.GRID_W,
            GRID_H: config.GRID_H,
            SQUARE_PX: config.SQUARE_PX,
          },
        }));
        break;
      }

      case 'rejoin': {
        // Player wants to rejoin after death
        const name = (msg.name || 'Anon').substring(0, 16);
        if (game.getTotalClaimedPct() >= config.MAX_TERRITORY_PCT) {
          ws.send(JSON.stringify({ type: 'lobby', reason: 'Map is too full. Waiting for space...' }));
          clientState.inLobby = true;
          return;
        }

        const player2 = game.spawnPlayer(name, false);
        if (!player2) {
          ws.send(JSON.stringify({ type: 'lobby', reason: 'Map is too full. Waiting for space...' }));
          clientState.inLobby = true;
          return;
        }

        clientState.playerId = player2.id;
        clientState.inLobby = false;
        ws.send(JSON.stringify({
          type: 'joined',
          playerId: player2.id,
          config: {
            GRID_W: config.GRID_W,
            GRID_H: config.GRID_H,
            SQUARE_PX: config.SQUARE_PX,
          },
        }));
        break;
      }
    }
  });

  ws.on('close', () => {
    if (clientState.playerId) {
      game.removePlayer(clientState.playerId);
    }
    clients.delete(ws);
  });
});

// --- Game loop ---
let lastTick = Date.now();

function gameLoop() {
  const now = Date.now();
  const interval = 1000 / config.BASE_TICK_RATE;

  if (now - lastTick >= interval) {
    lastTick = now;

    // Bot AI decisions
    botManager.tick();

    // Game tick — move all players
    game.tick();

    // Handle bot deaths + respawns
    botManager.handleBotDeaths();

    // Check for dead human players
    for (const [ws, clientState] of clients) {
      if (clientState.playerId && !clientState.inLobby) {
        const player = game.players.get(clientState.playerId);
        if (!player || !player.alive) {
          clientState.inLobby = true;
          const territory = player ? game.getPlayerTerritoryCount(clientState.playerId) : 0;
          try {
            ws.send(JSON.stringify({
              type: 'died',
              kills: player ? player.kills : 0,
              territory,
              reason: player ? player.deathReason : 'Unknown',
            }));
          } catch {}
        }
      }
    }

    // Broadcast state to all connected clients
    const state = game.getStateForClient();
    const colorMap = game.getColorMap();
    const deltaBuffer = game.getGridDelta();

    const stateMsg = JSON.stringify({
      type: 'state',
      ...state,
      colorMap,
    });

    for (const [ws, clientState] of clients) {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(stateMsg);
          // Send full grid for new clients, deltas for existing ones
          if (clientState.needsFullGrid) {
            ws.send(game.getGridData());
            clientState.needsFullGrid = false;
          } else {
            ws.send(deltaBuffer);
          }
        } catch {}
      }
    }
  }

  // Use setImmediate for tighter loop, setTimeout as fallback
  const nextInterval = Math.max(1, interval - (Date.now() - now));
  setTimeout(gameLoop, nextInterval);
}

// --- Start ---
server.listen(config.PORT, () => {
  console.log(`Game server running on http://localhost:${config.PORT}`);
  console.log(`Grid: ${config.GRID_W}x${config.GRID_H} | Square: ${config.SQUARE_PX}px | Bots: ${config.BOT_COUNT}`);
  gameLoop();
});
