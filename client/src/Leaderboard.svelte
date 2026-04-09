<script>
  export let leaderboard = [];
  export let playerId = null;
</script>

<div class="leaderboard">
  <h3>// GRID STATUS //</h3>
  {#each leaderboard as entry, i}
    <div class="entry" class:me={entry.id === playerId}>
      <span class="rank">{String(i + 1).padStart(2, '0')}</span>
      <span class="name">{entry.name}</span>
      <span class="score">{entry.score}</span>
    </div>
  {/each}
</div>

<style>
  .leaderboard {
    position: fixed;
    top: 10px;
    right: 10px;
    background: rgba(10, 9, 8, 0.85);
    border: 1px solid #2a2015;
    padding: 14px 16px;
    min-width: 200px;
    z-index: 50;
    backdrop-filter: blur(2px);
  }

  h3 {
    font-size: 10px;
    color: #5a4a35;
    letter-spacing: 3px;
    margin-bottom: 10px;
    text-align: center;
  }

  .entry {
    display: flex;
    gap: 10px;
    padding: 3px 0;
    font-size: 12px;
    color: #6a5a45;
    border-bottom: 1px solid rgba(42, 32, 21, 0.4);
  }

  .entry:last-child {
    border-bottom: none;
  }

  .entry.me {
    color: #c7a06a;
  }

  .rank {
    color: #3a2e1e;
    width: 20px;
    font-size: 10px;
  }

  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .score {
    color: #8a6530;
    min-width: 50px;
    text-align: right;
  }

  .entry.me .score {
    color: #c77d3a;
  }
</style>
