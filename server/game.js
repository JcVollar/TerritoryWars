const config = require('./config');

// Cell states: 0 = unclaimed, positive number = player id's territory
// Trail is tracked separately per player

class Game {
  constructor() {
    this.grid = new Uint16Array(config.GRID_W * config.GRID_H); // 0 = unclaimed
    this.players = new Map(); // id -> player object
    this.nextId = 1;
    this.tickCount = 0;
    this.dirtyCell = new Set(); // track changed cells for delta updates
    this.usedPlayerColors = new Set(); // ensure human players get unique colors
  }

  // --- Grid helpers ---

  idx(x, y) {
    return y * config.GRID_W + x;
  }

  inBounds(x, y) {
    return x >= 0 && x < config.GRID_W && y >= 0 && y < config.GRID_H;
  }

  getCell(x, y) {
    return this.grid[this.idx(x, y)];
  }

  setCell(x, y, val) {
    const i = this.idx(x, y);
    if (this.grid[i] !== val) {
      this.grid[i] = val;
      this.dirtyCell.add(i);
    }
  }

  // --- Territory stats ---

  getTotalClaimedCount() {
    let count = 0;
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] !== 0) count++;
    }
    return count;
  }

  getTotalClaimedPct() {
    return (this.getTotalClaimedCount() / (config.GRID_W * config.GRID_H)) * 100;
  }

  getPlayerTerritoryCount(playerId) {
    let count = 0;
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] === playerId) count++;
    }
    return count;
  }

  getUnclaimedPct() {
    return 100 - this.getTotalClaimedPct();
  }

  // --- Spawn ---

  findSpawnPoint(isBot = false) {
    // Try to find a large open area by random sampling
    const size = config.SPAWN_SIZE;
    const margin = size + 2;
    const minDistFromHumans = 80; // bots must spawn at least this far from humans
    let bestX = 0, bestY = 0, bestScore = -1;

    // Collect human player positions
    const humanPositions = [];
    if (isBot) {
      for (const [id, p] of this.players) {
        if (!p.isBot && p.alive) {
          humanPositions.push({ x: p.x, y: p.y });
        }
      }
    }

    for (let attempt = 0; attempt < 50; attempt++) {
      const x = margin + Math.floor(Math.random() * (config.GRID_W - 2 * margin));
      const y = margin + Math.floor(Math.random() * (config.GRID_H - 2 * margin));

      // Bots: check distance from human players
      if (isBot && humanPositions.length > 0) {
        let tooClose = false;
        for (const hp of humanPositions) {
          if (Math.abs(x - hp.x) + Math.abs(y - hp.y) < minDistFromHumans) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;
      }

      // Score: count unclaimed cells in a region around spawn
      let score = 0;
      const checkRadius = size + 5;
      for (let dy = -checkRadius; dy <= checkRadius; dy++) {
        for (let dx = -checkRadius; dx <= checkRadius; dx++) {
          const cx = x + dx, cy = y + dy;
          if (this.inBounds(cx, cy) && this.getCell(cx, cy) === 0) {
            score++;
          }
        }
      }

      // Also check that spawn patch itself is mostly clear
      let spawnClear = true;
      for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) {
          if (this.getCell(x + dx, y + dy) !== 0) {
            spawnClear = false;
            break;
          }
        }
        if (!spawnClear) break;
      }

      if (spawnClear && score > bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
    }

    return { x: bestX, y: bestY };
  }

  spawnPlayer(name, isBot = false) {
    // Check capacity
    if (!isBot && this.getTotalClaimedPct() >= config.MAX_TERRITORY_PCT) {
      return null; // lobby
    }

    const id = this.nextId++;
    const spawn = this.findSpawnPoint(isBot);
    const size = config.SPAWN_SIZE;

    const player = {
      id,
      name,
      isBot,
      alive: true,
      x: spawn.x + Math.floor(size / 2),
      y: spawn.y + Math.floor(size / 2),
      dir: 'right',    // current direction
      nextDir: 'right', // buffered input
      trail: [],        // [{x, y}, ...] — cells in current trail
      trailSet: new Set(), // "x,y" strings for fast lookup
      color: isBot ? this.randomBotColor() : this.uniquePlayerColor(),
      kills: 0,
      spawnedAt: this.tickCount,
    };

    // Claim spawn territory
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        this.setCell(spawn.x + dx, spawn.y + dy, id);
      }
    }

    this.players.set(id, player);
    return player;
  }

  // Bright unique colors for human players — guaranteed no duplicates
  uniquePlayerColor() {
    const playerColors = [
      '#ff003c', '#00fff0', '#ffe600', '#ff00ff', '#00ff66',
      '#ff6600', '#00aaff', '#ff0099', '#33ff00', '#cc00ff',
    ];
    for (const c of playerColors) {
      if (!this.usedPlayerColors.has(c)) {
        this.usedPlayerColors.add(c);
        return c;
      }
    }
    // Fallback: generate a random bright color
    const h = Math.floor(Math.random() * 360);
    return `hsl(${h}, 100%, 50%)`;
  }

  // Dimmer neon colors for bots — still neon but distinguishable from players
  randomBotColor() {
    const colors = [
      '#993355', '#338877', '#996633', '#335588', '#883399',
      '#339944', '#998833', '#333399', '#993366', '#339988',
      '#994422', '#3377aa', '#773399', '#559933', '#993344',
      '#337755', '#995522', '#224499', '#993377', '#337799',
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  // --- Player actions ---

  setDirection(playerId, dir) {
    const player = this.players.get(playerId);
    if (!player || !player.alive) return;

    // Prevent 180-degree reversal
    const opposites = { up: 'down', down: 'up', left: 'right', right: 'left' };
    if (opposites[dir] === player.dir && player.trail.length > 0) return;

    player.nextDir = dir;
  }

  // --- Tick ---

  tick() {
    this.tickCount++;

    for (const [id, player] of this.players) {
      if (!player.alive) continue;
      this.movePlayer(player);
    }
  }

  movePlayer(player) {
    // Apply buffered direction
    player.dir = player.nextDir;

    // Calculate new position
    let nx = player.x, ny = player.y;
    switch (player.dir) {
      case 'up':    ny--; break;
      case 'down':  ny++; break;
      case 'left':  nx--; break;
      case 'right': nx++; break;
    }

    // Wall collision — bounce to a random valid direction
    if (!this.inBounds(nx, ny)) {
      const dirs = ['up', 'down', 'left', 'right'];
      const valid = dirs.filter(d => {
        let tx = player.x, ty = player.y;
        switch (d) {
          case 'up': ty--; break;
          case 'down': ty++; break;
          case 'left': tx--; break;
          case 'right': tx++; break;
        }
        return this.inBounds(tx, ty) && !player.trailSet.has(`${tx},${ty}`);
      });
      if (valid.length === 0) {
        this.killPlayer(player, null, 'Trapped at wall');
        return;
      }
      const newDir = valid[Math.floor(Math.random() * valid.length)];
      player.dir = newDir;
      player.nextDir = newDir;
      // Recalculate position
      nx = player.x;
      ny = player.y;
      switch (newDir) {
        case 'up': ny--; break;
        case 'down': ny++; break;
        case 'left': nx--; break;
        case 'right': nx++; break;
      }
    }

    const cellOwner = this.getCell(nx, ny);
    const key = `${nx},${ny}`;

    // Check if we hit someone else's trail
    for (const [otherId, other] of this.players) {
      if (otherId === player.id || !other.alive) continue;
      if (other.trailSet.has(key)) {
        // Kill the other player (we crossed their trail)
        console.log(`[DEATH] "${other.name}" (id:${other.id}) trail crossed by "${player.name}" (id:${player.id}) at (${nx},${ny})`);
        this.killPlayer(other, player, `Trail crossed by ${player.name}`);
        break;
      }
    }

    // Hit own trail = death
    if (player.trailSet.has(key)) {
      console.log(`[DEATH] "${player.name}" (id:${player.id}) hit own trail at (${nx},${ny})`);
      this.killPlayer(player, null, 'Hit your own trail');
      return;
    }

    // Move
    player.x = nx;
    player.y = ny;

    const isOwnTerritory = cellOwner === player.id;

    if (isOwnTerritory && player.trail.length > 0) {
      // Returned to own territory — claim the trail area
      this.claimTrail(player);
    } else if (!isOwnTerritory) {
      // Outside own territory — extend trail
      player.trail.push({ x: nx, y: ny });
      player.trailSet.add(key);
    }
  }

  closeTrailLoop(player, hitX, hitY) {
    // Find where in the trail we hit, everything from there forms a loop
    const hitKey = `${hitX},${hitY}`;
    let loopStart = -1;
    for (let i = 0; i < player.trail.length; i++) {
      if (`${player.trail[i].x},${player.trail[i].y}` === hitKey) {
        loopStart = i;
        break;
      }
    }

    if (loopStart === -1) {
      // Shouldn't happen, but just claim trail normally
      this.claimTrail(player);
      return;
    }

    // The loop is from loopStart to end of trail
    const loopCells = player.trail.slice(loopStart);

    // Only claim the loop cells as territory (not the stem)
    const newCells = new Set();
    for (const cell of loopCells) {
      if (this.getCell(cell.x, cell.y) !== player.id) {
        newCells.add(`${cell.x},${cell.y}`);
      }
      this.setCell(cell.x, cell.y, player.id);
    }

    // Flood fill the interior of the loop
    const filledCells = this.floodFillLoop(player.id, loopCells);
    for (const key of filledCells) newCells.add(key);

    // Kill any enemies caught inside the NEWLY claimed area only
    this.killPlayersInNewCells(player, newCells);

    // Free disconnected territory for affected players
    this.freeDisconnectedTerritory(newCells);

    // Clear the entire trail (stem disappears)
    player.trail = [];
    player.trailSet.clear();
  }

  claimTrail(player) {
    // Claim all trail cells as territory
    const newCells = new Set();
    for (const cell of player.trail) {
      if (this.getCell(cell.x, cell.y) !== player.id) {
        newCells.add(`${cell.x},${cell.y}`);
      }
      this.setCell(cell.x, cell.y, player.id);
    }

    // Flood fill enclosed areas
    const filledCells = this.floodFillEnclosed(player.id);
    for (const key of filledCells) newCells.add(key);

    // Kill any enemies caught inside the NEWLY claimed area only
    this.killPlayersInNewCells(player, newCells);

    // Free disconnected territory for affected players
    this.freeDisconnectedTerritory(newCells);

    // Clear trail
    player.trail = [];
    player.trailSet.clear();
  }

  killPlayersInNewCells(player, newCells) {
    // Only kill enemies standing on cells that were JUST claimed
    for (const [id, other] of this.players) {
      if (id === player.id || !other.alive) continue;
      const key = `${other.x},${other.y}`;
      if (newCells.has(key)) {
        console.log(`[DEATH] "${other.name}" (id:${other.id}) caught inside territory claimed by "${player.name}" (id:${player.id}) at (${other.x},${other.y})`);
        this.killPlayer(other, player, `Enclosed by ${player.name}`);
      }
    }
  }

  freeDisconnectedTerritory(newCells) {
    // Check which player IDs border the newly claimed area — only those could be split
    const affectedIds = new Set();
    for (const key of newCells) {
      const [cx, cy] = key.split(',').map(Number);
      const neighbors = [
        [cx - 1, cy], [cx + 1, cy],
        [cx, cy - 1], [cx, cy + 1],
      ];
      for (const [nx, ny] of neighbors) {
        if (this.inBounds(nx, ny)) {
          const owner = this.getCell(nx, ny);
          if (owner !== 0) affectedIds.add(owner);
        }
      }
    }

    for (const id of affectedIds) {
      const player = this.players.get(id);
      if (player && player.alive) {
        this.freeDisconnectedForPlayer(player);
      }
    }
  }

  freeDisconnectedForPlayer(player) {
    // BFS from the player's head position to find all connected territory
    // Anything owned by this player but not connected gets freed

    const playerId = player.id;

    // Quick check: is the player standing on their own territory?
    if (this.getCell(player.x, player.y) !== playerId) return;

    // Find bounding box of player's territory for efficiency
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let totalCells = 0;
    for (let y = 0; y < config.GRID_H; y++) {
      for (let x = 0; x < config.GRID_W; x++) {
        if (this.getCell(x, y) === playerId) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
          totalCells++;
        }
      }
    }

    if (totalCells === 0) return;

    // BFS from player position to find connected territory
    const visited = new Set();
    const queue = [`${player.x},${player.y}`];
    visited.add(queue[0]);

    let qi = 0;
    while (qi < queue.length) {
      const key = queue[qi++];
      const [cx, cy] = key.split(',').map(Number);

      const neighbors = [
        [cx - 1, cy], [cx + 1, cy],
        [cx, cy - 1], [cx, cy + 1],
      ];

      for (const [nx, ny] of neighbors) {
        if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
        const nKey = `${nx},${ny}`;
        if (visited.has(nKey)) continue;
        if (this.getCell(nx, ny) === playerId) {
          visited.add(nKey);
          queue.push(nKey);
        }
      }
    }

    // If connected count equals total, nothing is disconnected
    if (visited.size >= totalCells) return;

    // Free all cells NOT connected to the player
    let freed = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (this.getCell(x, y) === playerId && !visited.has(`${x},${y}`)) {
          this.setCell(x, y, 0);
          freed++;
        }
      }
    }

    if (freed > 0) {
      console.log(`[SPLIT] "${player.name}" (id:${playerId}) lost ${freed} disconnected cells`);
    }
  }

  floodFillLoop(playerId, loopCells) {
    // Use the loop cells as a boundary and fill the interior
    // Simple approach: find bounding box, then flood-fill from outside to find what's NOT enclosed
    if (loopCells.length < 3) return new Set();

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of loopCells) {
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y);
      maxY = Math.max(maxY, c.y);
    }

    // Expand bounding box by 1 for the flood-fill border
    minX = Math.max(0, minX - 1);
    minY = Math.max(0, minY - 1);
    maxX = Math.min(config.GRID_W - 1, maxX + 1);
    maxY = Math.min(config.GRID_H - 1, maxY + 1);

    const w = maxX - minX + 1;
    const h = maxY - minY + 1;

    // Create a local grid: 0 = unknown, 1 = boundary/owned, 2 = outside
    const local = new Uint8Array(w * h);

    // Mark boundary (loop cells + any cell already owned by this player)
    for (const c of loopCells) {
      local[(c.y - minY) * w + (c.x - minX)] = 1;
    }
    for (let ly = 0; ly < h; ly++) {
      for (let lx = 0; lx < w; lx++) {
        if (this.getCell(minX + lx, minY + ly) === playerId) {
          local[ly * w + lx] = 1;
        }
      }
    }

    // Flood fill from all edge cells that aren't boundary
    const queue = [];
    for (let lx = 0; lx < w; lx++) {
      if (local[lx] === 0) { local[lx] = 2; queue.push(lx, 0); }
      const bi = (h - 1) * w + lx;
      if (local[bi] === 0) { local[bi] = 2; queue.push(lx, h - 1); }
    }
    for (let ly = 0; ly < h; ly++) {
      const li = ly * w;
      if (local[li] === 0) { local[li] = 2; queue.push(0, ly); }
      const ri = ly * w + (w - 1);
      if (local[ri] === 0) { local[ri] = 2; queue.push(w - 1, ly); }
    }

    let qi = 0;
    while (qi < queue.length) {
      const qx = queue[qi++];
      const qy = queue[qi++];
      const neighbors = [[qx-1,qy],[qx+1,qy],[qx,qy-1],[qx,qy+1]];
      for (const [nx, ny] of neighbors) {
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          const ni = ny * w + nx;
          if (local[ni] === 0) {
            local[ni] = 2;
            queue.push(nx, ny);
          }
        }
      }
    }

    // Everything still 0 is interior — claim it (including enemy territory)
    const newCells = new Set();
    for (let ly = 0; ly < h; ly++) {
      for (let lx = 0; lx < w; lx++) {
        if (local[ly * w + lx] === 0) {
          const gx = minX + lx, gy = minY + ly;
          if (this.getCell(gx, gy) !== playerId) {
            newCells.add(`${gx},${gy}`);
          }
          this.setCell(gx, gy, playerId);
        }
      }
    }
    return newCells;
  }

  floodFillEnclosed(playerId) {
    // Find all cells enclosed by player's territory + trail
    // Use the same outside-flood approach but on the full grid boundary
    // Optimization: only check the bounding box of the player's territory

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let y = 0; y < config.GRID_H; y++) {
      for (let x = 0; x < config.GRID_W; x++) {
        if (this.getCell(x, y) === playerId) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (minX === Infinity) return new Set();

    minX = Math.max(0, minX - 1);
    minY = Math.max(0, minY - 1);
    maxX = Math.min(config.GRID_W - 1, maxX + 1);
    maxY = Math.min(config.GRID_H - 1, maxY + 1);

    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const local = new Uint8Array(w * h);

    // Mark player-owned cells as boundary
    for (let ly = 0; ly < h; ly++) {
      for (let lx = 0; lx < w; lx++) {
        if (this.getCell(minX + lx, minY + ly) === playerId) {
          local[ly * w + lx] = 1;
        }
      }
    }

    // Flood fill outside from edges
    const queue = [];
    for (let lx = 0; lx < w; lx++) {
      if (local[lx] === 0) { local[lx] = 2; queue.push(lx, 0); }
      const bi = (h - 1) * w + lx;
      if (local[bi] === 0) { local[bi] = 2; queue.push(lx, h - 1); }
    }
    for (let ly = 0; ly < h; ly++) {
      const li = ly * w;
      if (local[li] === 0) { local[li] = 2; queue.push(0, ly); }
      const ri = ly * w + (w - 1);
      if (local[ri] === 0) { local[ri] = 2; queue.push(w - 1, ly); }
    }

    let qi = 0;
    while (qi < queue.length) {
      const qx = queue[qi++];
      const qy = queue[qi++];
      const neighbors = [[qx-1,qy],[qx+1,qy],[qx,qy-1],[qx,qy+1]];
      for (const [nx, ny] of neighbors) {
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          const ni = ny * w + nx;
          if (local[ni] === 0) {
            local[ni] = 2;
            queue.push(nx, ny);
          }
        }
      }
    }

    // Claim interior cells (still 0) — including enemy territory
    const newCells = new Set();
    for (let ly = 0; ly < h; ly++) {
      for (let lx = 0; lx < w; lx++) {
        if (local[ly * w + lx] === 0) {
          const gx = minX + lx, gy = minY + ly;
          if (this.getCell(gx, gy) !== playerId) {
            newCells.add(`${gx},${gy}`);
          }
          this.setCell(gx, gy, playerId);
        }
      }
    }
    return newCells;
  }

  // --- Death ---

  killPlayer(player, killer = null, reason = '') {
    player.alive = false;
    player.deathReason = reason || (killer ? `Killed by ${killer.name}` : 'Unknown');

    if (killer) {
      killer.kills++;
    }

    // Release territory — make it unclaimed
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] === player.id) {
        this.grid[i] = 0;
        this.dirtyCell.add(i);
      }
    }

    // Clear trail
    player.trail = [];
    player.trailSet.clear();
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (player) {
      if (player.alive) this.killPlayer(player);
      if (!player.isBot) this.usedPlayerColors.delete(player.color);
    }
    this.players.delete(playerId);
  }

  // --- Leaderboard ---

  getLeaderboard() {
    const entries = [];
    for (const [id, player] of this.players) {
      if (!player.alive) continue;
      const territory = this.getPlayerTerritoryCount(id);
      entries.push({
        id,
        name: player.name,
        territory,
        kills: player.kills,
        score: territory + (player.kills * 100),
        isBot: player.isBot,
      });
    }
    entries.sort((a, b) => b.score - a.score);
    return entries.slice(0, 5);
  }

  // --- State for client ---

  getStateForClient() {
    // Build a compact state to send to clients
    const players = [];
    for (const [id, p] of this.players) {
      if (!p.alive) continue;
      players.push({
        id: p.id,
        name: p.name,
        x: p.x,
        y: p.y,
        color: p.color,
        trail: p.trail,
        isBot: p.isBot,
      });
    }

    return {
      tick: this.tickCount,
      players,
      leaderboard: this.getLeaderboard(),
      claimedPct: this.getTotalClaimedPct(),
    };
  }

  // Full grid as raw buffer (used for initial sync)
  getGridData() {
    return Buffer.from(this.grid.buffer);
  }

  // Delta: only changed cells since last call
  // Format: [index(uint32), value(uint16)] pairs packed into a buffer
  getGridDelta() {
    const dirty = this.dirtyCell;
    // Each entry: 4 bytes index + 2 bytes value = 6 bytes
    const buf = Buffer.alloc(dirty.size * 6);
    let offset = 0;
    for (const i of dirty) {
      buf.writeUInt32LE(i, offset);
      buf.writeUInt16LE(this.grid[i], offset + 4);
      offset += 6;
    }
    dirty.clear();
    return buf;
  }

  getDirtyCount() {
    return this.dirtyCell.size;
  }

  // Get player color map for client rendering
  getColorMap() {
    const map = {};
    for (const [id, p] of this.players) {
      map[id] = p.color;
    }
    return map;
  }

  // --- Speed calculation ---

  getPlayerSpeed(player) {
    const territoryPct = this.getPlayerTerritoryCount(player.id) / (config.GRID_W * config.GRID_H);
    const speedFactor = Math.min(territoryPct / config.SPEED_TERRITORY_CAP, 1);
    return config.BASE_TICK_RATE * (1 + speedFactor * (config.SPEED_SCALE - 1));
  }
}

module.exports = Game;
