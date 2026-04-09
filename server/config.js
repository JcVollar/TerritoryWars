// ============================================
// GAME CONFIGURATION — tweak these to tune gameplay
// ============================================

module.exports = {
  // Grid dimensions (in squares)
  GRID_W: 500,
  GRID_H: 500,

  // Pixel size of each square (client rendering)
  SQUARE_PX: 8,

  // Movement speed
  BASE_TICK_RATE: 22,       // ticks per second at 0% territory
  SPEED_SCALE: 1.3,         // max speed multiplier at max territory
  SPEED_TERRITORY_CAP: 0.3, // territory % where speed maxes out (30%)

  // Spawn
  SPAWN_SIZE: 5,            // starting territory (5x5 patch)

  // Territory limits
  MAX_TERRITORY_PCT: 75,    // lobby lock when total claimed > this %

  // Bots
  BOT_COUNT: 80,            // starting number of bots
  BOT_NAMES: [
    'Ziggy', 'Blitz', 'Neon', 'Pixel', 'Turbo',
    'Glitch', 'Byte', 'Spark', 'Dash', 'Volt',
    'Echo', 'Nova', 'Flux', 'Chip', 'Zap',
    'Orbit', 'Pulse', 'Drift', 'Hexa', 'Prism',
    'Comet', 'Laser', 'Rogue', 'Storm', 'Blaze',
    'Phantom', 'Rocket', 'Shadow', 'Viper', 'Titan',
  ],

  // Bot AI tuning
  BOT_MIN_LOOP: 3,          // min squares a bot ventures out
  BOT_MAX_LOOP: 8,          // max squares a bot ventures out
  BOT_VISION_RANGE: 60,     // how far a bot can "see" other players
  BOT_DANGER_RANGE: 6,      // range at which bot gets cautious / tries to return
  BOT_CHASE_RANGE: 40,      // range at which bot will chase a vulnerable enemy

  // Server
  PORT: 3099,
};
