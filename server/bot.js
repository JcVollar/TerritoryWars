const config = require('./config');

class BotManager {
  constructor(game) {
    this.game = game;
    this.bots = new Map();
    this.usedNames = new Set();
  }

  getRandomName() {
    const available = config.BOT_NAMES.filter(n => !this.usedNames.has(n));
    if (available.length === 0) {
      return `Bot${Math.floor(Math.random() * 9999)}`;
    }
    const name = available[Math.floor(Math.random() * available.length)];
    this.usedNames.add(name);
    return name;
  }

  spawnBot() {
    const name = this.getRandomName();
    const player = this.game.spawnPlayer(name, true);
    if (!player) return null;

    this.bots.set(player.id, {
      playerId: player.id,
      state: 'in_territory',
      stepsOut: 0,
      targetSteps: this.randomLoopSize(),
      turnCounter: 0,
      turnInterval: 3 + Math.floor(Math.random() * 5),
      chaseTarget: null,
      lockTicks: 0,
      // Personality — each bot has slight variation
      aggression: 0.5 + Math.random() * 0.5,  // 0.5 - 1.0
      loopStyle: Math.random(),                 // 0 = small safe loops, 1 = big risky loops
    });

    return player;
  }

  randomLoopSize(botState) {
    return config.BOT_MIN_LOOP + Math.floor(Math.random() * (config.BOT_MAX_LOOP - config.BOT_MIN_LOOP + 1));
  }

  getMaxBots() {
    const unclaimedPct = this.game.getUnclaimedPct();
    return Math.max(1, Math.floor(config.BOT_COUNT * (unclaimedPct / 100)));
  }

  spawnInitialBots() {
    for (let i = 0; i < config.BOT_COUNT; i++) {
      this.spawnBot();
    }
  }

  handleBotDeaths() {
    const deadBots = [];
    for (const [playerId, botState] of this.bots) {
      const player = this.game.players.get(playerId);
      if (!player || !player.alive) {
        deadBots.push(playerId);
      }
    }

    for (const id of deadBots) {
      const player = this.game.players.get(id);
      if (player) this.usedNames.delete(player.name);
      this.game.removePlayer(id);
      this.bots.delete(id);
    }

    const maxBots = this.getMaxBots();
    const toSpawn = Math.max(0, maxBots - this.bots.size);
    for (let i = 0; i < toSpawn; i++) this.spawnBot();
  }

  tick() {
    for (const [playerId, botState] of this.bots) {
      const player = this.game.players.get(playerId);
      if (!player || !player.alive) continue;
      this.updateBot(player, botState);
    }
  }

  // --- Vision ---

  scanForEnemies(player) {
    const found = [];
    for (const [id, other] of this.game.players) {
      if (id === player.id || !other.alive) continue;

      const hasTrail = other.trail.length > 0;
      const headDist = Math.abs(other.x - player.x) + Math.abs(other.y - player.y);

      let nearestTrailDist = Infinity;
      let nearestTrailCell = null;
      if (hasTrail) {
        const step = Math.max(1, Math.floor(other.trail.length / 20));
        for (let i = 0; i < other.trail.length; i += step) {
          const cell = other.trail[i];
          const d = Math.abs(cell.x - player.x) + Math.abs(cell.y - player.y);
          if (d < nearestTrailDist) { nearestTrailDist = d; nearestTrailCell = cell; }
        }
        for (let i = Math.max(0, other.trail.length - 5); i < other.trail.length; i++) {
          const cell = other.trail[i];
          const d = Math.abs(cell.x - player.x) + Math.abs(cell.y - player.y);
          if (d < nearestTrailDist) { nearestTrailDist = d; nearestTrailCell = cell; }
        }
      }

      found.push({
        player: other,
        dist: Math.min(headDist, nearestTrailDist),
        headDist,
        hasTrail,
        nearestTrailDist,
        nearestTrailCell,
      });
    }

    found.sort((a, b) => a.dist - b.dist);
    return found;
  }

  // --- Predict where an enemy is heading ---

  predictPosition(other, ticksAhead) {
    const offsets = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const [dx, dy] = offsets[other.dir] || [0, 0];
    return {
      x: other.x + dx * ticksAhead,
      y: other.y + dy * ticksAhead,
    };
  }

  // --- Find the best intercept point on an enemy's trail ---
  // Instead of just "nearest trail cell", find where to cut them off

  findInterceptPoint(bot, enemy) {
    if (enemy.trail.length === 0) return null;

    const enemySafety = this.distToOwnTerritory(enemy);

    // Strategy 1: Cut between the enemy and their territory
    // Find the trail cell that's closest to the enemy's territory
    // (cutting them off from returning)
    let cutoffTarget = null;
    let cutoffScore = -Infinity;

    // Strategy 2: Just go for the nearest reachable trail cell
    let nearestTarget = null;
    let nearestDist = Infinity;

    // Strategy 3: Predict where enemy is going and get ahead
    const predicted = this.predictPosition(enemy, 8);

    for (const cell of enemy.trail) {
      const botDist = Math.abs(cell.x - bot.x) + Math.abs(cell.y - bot.y);

      // Nearest trail cell
      if (botDist < nearestDist) {
        nearestDist = botDist;
        nearestTarget = cell;
      }

      // Cutoff scoring: prefer trail cells that are between enemy and their territory
      // and that we can reach before the enemy gets home
      const cellToEnemy = Math.abs(cell.x - enemy.x) + Math.abs(cell.y - enemy.y);
      const advantage = enemySafety - botDist;
      // Bonus for cells near the enemy's path home
      const cutoffBonus = cellToEnemy < enemySafety ? 5 : 0;
      const score = advantage + cutoffBonus;

      if (score > cutoffScore) {
        cutoffScore = score;
        cutoffTarget = cell;
      }
    }

    // If we can cut them off, do it
    if (cutoffTarget && cutoffScore >= -5) return cutoffTarget;

    // If trail is close, just go for it
    if (nearestTarget && nearestDist <= 15) return nearestTarget;

    // If we can't intercept trail, predict where they're heading and get in front
    if (predicted && this.game.inBounds(predicted.x, predicted.y)) {
      const predDist = Math.abs(predicted.x - bot.x) + Math.abs(predicted.y - bot.y);
      if (predDist <= config.BOT_CHASE_RANGE) return predicted;
    }

    return nearestTarget;
  }

  // --- Main AI update ---

  updateBot(player, botState) {
    const isInOwnTerritory = this.game.getCell(player.x, player.y) === player.id;
    const hasTrail = player.trail.length > 0;
    const enemies = this.scanForEnemies(player);
    const nearestEnemy = enemies.length > 0 ? enemies[0] : null;

    // --- Emergency: about to hit wall or own trail ---
    const nextPos = this.getNextPos(player);
    if (!this.game.inBounds(nextPos.x, nextPos.y) || player.trailSet.has(`${nextPos.x},${nextPos.y}`)) {
      const safeDirs = this.getSafeDirections(player);
      if (safeDirs.length > 0) {
        // Pick the best emergency direction (prefer toward territory if we have trail)
        if (hasTrail) {
          const returnDir = this.directionToOwnTerritory(player);
          if (returnDir && safeDirs.includes(returnDir)) {
            this.game.setDirection(player.id, returnDir);
          } else {
            this.game.setDirection(player.id, safeDirs[0]);
          }
        } else {
          this.game.setDirection(player.id, safeDirs[Math.floor(Math.random() * safeDirs.length)]);
        }
        botState.lockTicks = 2;
      }
      return;
    }

    // --- Direction lock ---
    if (botState.lockTicks > 0) {
      botState.lockTicks--;
      return;
    }

    // --- FLEE: We have a long trail and enemy is very close ---
    if (hasTrail && nearestEnemy && nearestEnemy.dist <= config.BOT_DANGER_RANGE && player.trail.length > 6) {
      botState.state = 'fleeing';
      const returnDir = this.directionToOwnTerritory(player);
      if (returnDir) {
        this.game.setDirection(player.id, returnDir);
        botState.lockTicks = 2;
      }
      return;
    }

    // --- OPPORTUNISTIC KILL: Enemy trail is very close and easy to reach ---
    // Only chase if the trail is really nearby — don't abandon territory plans for far targets
    for (const enemy of enemies) {
      if (!enemy.hasTrail) continue;
      if (enemy.nearestTrailDist > 12) continue; // only react to very close trails

      const intercept = this.findInterceptPoint(player, enemy.player);
      if (intercept) {
        const interceptDist = Math.abs(intercept.x - player.x) + Math.abs(intercept.y - player.y);
        if (interceptDist <= 15) { // only if we can reach it quickly
          botState.state = 'chasing';
          botState.chaseTarget = enemy.player.id;
          const chaseDir = this.directionToTarget(player, intercept.x, intercept.y);
          if (chaseDir) {
            this.game.setDirection(player.id, chaseDir);
            botState.lockTicks = 2 + Math.floor(Math.random() * 2);
          }
          return;
        }
      }
    }

    // --- PRIMARY GOAL: Build territory ---

    if (isInOwnTerritory && !hasTrail) {
      // Plan the next territory-claiming expedition
      botState.state = 'exploring';
      botState.stepsOut = 0;
      botState.chaseTarget = null;

      // Decide loop shape: pick a target area to claim
      // Look for the best direction with the most unclaimed/enemy space to conquer
      const dirs = this.getSafeDirections(player);
      if (dirs.length > 0) {
        const scored = dirs.map(dir => {
          const { dx, dy } = this.dirToOffset(dir);
          let score = 0;
          for (let i = 1; i <= 15; i++) {
            const cx = player.x + dx * i;
            const cy = player.y + dy * i;
            if (!this.game.inBounds(cx, cy)) { score -= 5; break; }
            const cell = this.game.getCell(cx, cy);
            if (cell === 0) score += 3;           // unclaimed = best
            else if (cell !== player.id) score += 2; // enemy territory = valuable to take
            else score -= 1;                        // own territory = no value
          }
          // Bonus: if an enemy is roughly in this direction, plan to go near them
          // (sets up future kill opportunities while claiming)
          if (nearestEnemy && nearestEnemy.headDist <= config.BOT_CHASE_RANGE) {
            const edx = nearestEnemy.player.x - player.x;
            const edy = nearestEnemy.player.y - player.y;
            if ((dir === 'right' && edx > 0) || (dir === 'left' && edx < 0) ||
                (dir === 'down' && edy > 0) || (dir === 'up' && edy < 0)) {
              score += 4; // prefer expanding toward enemies
            }
          }
          return { dir, score };
        });
        scored.sort((a, b) => b.score - a.score);

        // Small, tight loops — claim territory safely
        botState.targetSteps = this.randomLoopSize(botState);

        const topIdx = Math.min(scored.length - 1, Math.floor(Math.random() * 2));
        this.game.setDirection(player.id, scored[topIdx].dir);
        botState.lockTicks = 4 + Math.floor(Math.random() * 4);
      }

    } else if (hasTrail) {
      botState.stepsOut++;
      botState.turnCounter++;

      // While out claiming, check for easy kills nearby
      for (const enemy of enemies) {
        if (!enemy.hasTrail) continue;
        if (enemy.nearestTrailDist > 8) continue;
        // Very close trail — quick detour to kill
        if (enemy.nearestTrailCell) {
          const detourDir = this.directionToTarget(player, enemy.nearestTrailCell.x, enemy.nearestTrailCell.y);
          if (detourDir) {
            this.game.setDirection(player.id, detourDir);
            botState.lockTicks = 2;
            return;
          }
        }
      }

      if (botState.stepsOut >= botState.targetSteps || botState.state === 'returning') {
        // Head back — make a good loop shape
        botState.state = 'returning';
        if (botState.turnCounter >= 2) {
          botState.turnCounter = 0;

          // First time reaching target: perpendicular turn to make a rectangle
          if (botState.stepsOut === botState.targetSteps && player.trail.length > 2) {
            const returnDir = this.directionToOwnTerritory(player);
            const perp = this.getPerpendicularDir(returnDir);
            const safe = this.getSafeDirections(player);
            if (perp && safe.includes(perp)) {
              this.game.setDirection(player.id, perp);
              botState.lockTicks = 2 + Math.floor(Math.random() * 2); // short side
              botState.stepsOut++;
              return;
            }
          }

          const returnDir = this.directionToOwnTerritory(player);
          if (returnDir) {
            this.game.setDirection(player.id, returnDir);
            botState.lockTicks = 3 + Math.floor(Math.random() * 2);
          }
        }
      } else if (botState.turnCounter >= botState.turnInterval) {
        botState.turnCounter = 0;
        botState.turnInterval = 5 + Math.floor(Math.random() * 5);

        // While exploring, prefer directions that expand into unclaimed/enemy space
        const dirs = this.getSafeDirections(player);
        if (dirs.length > 0) {
          const scored = dirs.map(dir => {
            const { dx, dy } = this.dirToOffset(dir);
            let score = 0;
            for (let i = 1; i <= 8; i++) {
              const cx = player.x + dx * i;
              const cy = player.y + dy * i;
              if (!this.game.inBounds(cx, cy)) { score -= 5; break; }
              if (player.trailSet.has(`${cx},${cy}`)) { score -= 10; break; }
              const cell = this.game.getCell(cx, cy);
              if (cell === 0) score += 3;
              else if (cell !== player.id) score += 2;
            }
            return { dir, score };
          });
          scored.sort((a, b) => b.score - a.score);
          this.game.setDirection(player.id, scored[0].dir);
          botState.lockTicks = 4 + Math.floor(Math.random() * 4);
        }
      }
    }
  }

  // --- Helpers ---

  getPerpendicularDir(dir) {
    const perps = { up: ['left', 'right'], down: ['left', 'right'], left: ['up', 'down'], right: ['up', 'down'] };
    const options = perps[dir];
    return options ? options[Math.floor(Math.random() * 2)] : null;
  }

  getNextPos(player) {
    let x = player.x, y = player.y;
    switch (player.nextDir) {
      case 'up': y--; break;
      case 'down': y++; break;
      case 'left': x--; break;
      case 'right': x++; break;
    }
    return { x, y };
  }

  dirToOffset(dir) {
    switch (dir) {
      case 'up':    return { dx: 0, dy: -1 };
      case 'down':  return { dx: 0, dy: 1 };
      case 'left':  return { dx: -1, dy: 0 };
      case 'right': return { dx: 1, dy: 0 };
    }
  }

  distToOwnTerritory(player) {
    let bestDist = Infinity;
    const step = 2;
    const range = 40;
    for (let y = Math.max(0, player.y - range); y < Math.min(config.GRID_H, player.y + range); y += step) {
      for (let x = Math.max(0, player.x - range); x < Math.min(config.GRID_W, player.x + range); x += step) {
        if (this.game.getCell(x, y) === player.id) {
          const dist = Math.abs(x - player.x) + Math.abs(y - player.y);
          if (dist < bestDist) bestDist = dist;
        }
      }
    }
    return bestDist;
  }

  getSafeDirections(player) {
    const dirs = ['up', 'down', 'left', 'right'];
    const opposites = { up: 'down', down: 'up', left: 'right', right: 'left' };
    const safe = [];

    for (const dir of dirs) {
      if (player.trail.length > 0 && dir === opposites[player.dir]) continue;

      const { dx, dy } = this.dirToOffset(dir);
      const nx = player.x + dx;
      const ny = player.y + dy;

      if (!this.game.inBounds(nx, ny)) continue;
      if (player.trailSet.has(`${nx},${ny}`)) continue;

      // Look ahead 3 steps for trail collision
      let safe3 = true;
      for (let i = 2; i <= 3; i++) {
        const fx = player.x + dx * i;
        const fy = player.y + dy * i;
        if (this.game.inBounds(fx, fy) && player.trailSet.has(`${fx},${fy}`)) {
          safe3 = false;
          break;
        }
      }
      if (!safe3) continue;

      safe.push(dir);
    }

    if (safe.length > 0) return safe;

    // Desperate: just avoid immediate death
    const desperate = [];
    for (const dir of dirs) {
      const { dx, dy } = this.dirToOffset(dir);
      const nx = player.x + dx;
      const ny = player.y + dy;
      if (!this.game.inBounds(nx, ny)) continue;
      if (player.trailSet.has(`${nx},${ny}`)) continue;
      desperate.push(dir);
    }
    return desperate.length > 0 ? desperate : ['up'];
  }

  directionToTarget(player, tx, ty) {
    const dx = tx - player.x;
    const dy = ty - player.y;

    // Build candidates prioritized by which axis is further
    let candidates;
    if (Math.abs(dx) > Math.abs(dy)) {
      candidates = dx > 0
        ? ['right', dy > 0 ? 'down' : 'up', dy > 0 ? 'up' : 'down', 'left']
        : ['left', dy > 0 ? 'down' : 'up', dy > 0 ? 'up' : 'down', 'right'];
    } else {
      candidates = dy > 0
        ? ['down', dx > 0 ? 'right' : 'left', dx > 0 ? 'left' : 'right', 'up']
        : ['up', dx > 0 ? 'right' : 'left', dx > 0 ? 'left' : 'right', 'down'];
    }

    const safe = this.getSafeDirections(player);
    const safeSet = new Set(safe);

    for (const dir of candidates) {
      if (safeSet.has(dir)) return dir;
    }
    return safe.length > 0 ? safe[0] : null;
  }

  directionToOwnTerritory(player) {
    let bestDist = Infinity;
    let bestX = player.x, bestY = player.y;

    const step = 2;
    const range = 50;
    for (let y = Math.max(0, player.y - range); y < Math.min(config.GRID_H, player.y + range); y += step) {
      for (let x = Math.max(0, player.x - range); x < Math.min(config.GRID_W, player.x + range); x += step) {
        if (this.game.getCell(x, y) === player.id) {
          const dist = Math.abs(x - player.x) + Math.abs(y - player.y);
          if (dist < bestDist) {
            bestDist = dist;
            bestX = x;
            bestY = y;
          }
        }
      }
    }

    return this.directionToTarget(player, bestX, bestY);
  }
}

module.exports = BotManager;
