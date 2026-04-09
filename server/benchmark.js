const config = require('./config');
const Game = require('./game');
const BotManager = require('./bot');

function benchmark(gridW, gridH, botCount, ticks = 100) {
  // Override config
  config.GRID_W = gridW;
  config.GRID_H = gridH;
  config.BOT_COUNT = botCount;

  const game = new Game();
  // Reinitialize grid with new size
  game.grid = new Uint16Array(gridW * gridH);

  const bm = new BotManager(game);
  bm.spawnInitialBots();

  const gridBytes = gridW * gridH * 2;
  const gridMB = (gridBytes / 1024 / 1024).toFixed(2);

  // Warm up
  for (let i = 0; i < 10; i++) {
    bm.tick();
    game.tick();
    bm.handleBotDeaths();
  }

  // Measure tick time
  const start = performance.now();
  for (let i = 0; i < ticks; i++) {
    bm.tick();
    game.tick();
    bm.handleBotDeaths();
  }
  const elapsed = performance.now() - start;
  const avgTick = elapsed / ticks;

  // Measure state serialization (what gets sent to clients)
  const stateStart = performance.now();
  for (let i = 0; i < ticks; i++) {
    const state = game.getStateForClient();
    const colorMap = game.getColorMap();
    JSON.stringify({ type: 'state', ...state, colorMap });
    game.getGridData();
  }
  const stateElapsed = performance.now() - stateStart;
  const avgState = stateElapsed / ticks;

  const maxFPS = 1000 / (avgTick + avgState);
  const alive = [...game.players.values()].filter(p => p.alive).length;

  console.log(
    `${String(gridW).padStart(4)}x${String(gridH).padEnd(4)} | ` +
    `${String(botCount).padStart(3)} bots (${String(alive).padStart(3)} alive) | ` +
    `grid: ${gridMB.padStart(5)}MB | ` +
    `tick: ${avgTick.toFixed(2).padStart(7)}ms | ` +
    `state: ${avgState.toFixed(2).padStart(7)}ms | ` +
    `max tick rate: ${maxFPS.toFixed(0).padStart(4)} fps`
  );

  return { avgTick, avgState, maxFPS };
}

console.log('='.repeat(100));
console.log('TERRITORY SNAKE — STRESS TEST');
console.log('='.repeat(100));
console.log('');

// Test different grid sizes with 15 bots
console.log('--- Grid size scaling (15 bots) ---');
benchmark(100, 100, 15);
benchmark(200, 200, 15);
benchmark(300, 300, 15);
benchmark(400, 400, 15);
benchmark(500, 500, 15);
benchmark(800, 800, 15);
benchmark(1000, 1000, 15);

console.log('');

// Test different bot counts on 200x200
console.log('--- Bot count scaling (200x200) ---');
config.GRID_W = 200;
config.GRID_H = 200;
benchmark(200, 200, 5);
benchmark(200, 200, 15);
benchmark(200, 200, 30);
benchmark(200, 200, 50);
benchmark(200, 200, 75);
benchmark(200, 200, 100);

console.log('');

// Test different bot counts on 500x500
console.log('--- Bot count scaling (500x500) ---');
benchmark(500, 500, 15);
benchmark(500, 500, 30);
benchmark(500, 500, 50);
benchmark(500, 500, 100);

console.log('');

// Big combos
console.log('--- Large combinations ---');
benchmark(400, 400, 50);
benchmark(500, 500, 50);
benchmark(800, 800, 30);
benchmark(1000, 1000, 30);

console.log('');
console.log('Target: tick + state < 100ms for 10 fps tick rate');
console.log('Target: tick + state < 66ms for 15 fps tick rate');
