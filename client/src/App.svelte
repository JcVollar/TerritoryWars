<script>
  import Splash from './Splash.svelte';
  import Game from './Game.svelte';

  let screen = 'splash'; // 'splash', 'game', 'spectate', 'lobby', 'dead'
  let playerName = '';
  let ws = null;
  let playerId = null;
  let gameConfig = null;
  let deathInfo = null;
  let lobbyReason = '';
  let spectating = false;

  function getWsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = location.port === '5173' ? 'localhost:3099' : location.host;
    return `${proto}//${host}`;
  }

  function setupWs(onOpen) {
    ws = new WebSocket(getWsUrl());
    ws.binaryType = 'arraybuffer';

    ws.onopen = onOpen;

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) return;
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      switch (msg.type) {
        case 'joined':
          playerId = msg.playerId;
          gameConfig = msg.config;
          spectating = false;
          screen = 'game';
          break;
        case 'spectating':
          playerId = null;
          gameConfig = msg.config;
          spectating = true;
          screen = 'game';
          break;
        case 'lobby':
          lobbyReason = msg.reason;
          screen = 'lobby';
          break;
        case 'died':
          deathInfo = msg;
          screen = 'dead';
          break;
      }
    };

    ws.onclose = () => {
      screen = 'splash';
      ws = null;
    };

    ws.onerror = () => {
      screen = 'splash';
    };
  }

  function handleJoin(name) {
    playerName = name;
    setupWs(() => {
      ws.send(JSON.stringify({ type: 'join', name: playerName }));
    });
  }

  function handleSpectate() {
    setupWs(() => {
      ws.send(JSON.stringify({ type: 'spectate' }));
    });
  }

  function handleRejoin() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'rejoin', name: playerName }));
    } else {
      handleJoin(playerName);
    }
  }

  function handleBackToSplash() {
    if (ws) {
      ws.close();
      ws = null;
    }
    screen = 'splash';
  }
</script>

{#if screen === 'splash'}
  <Splash onJoin={handleJoin} onSpectate={handleSpectate} />

{:else if screen === 'game'}
  <Game {ws} {playerId} {gameConfig} {spectating} />

{:else if screen === 'lobby'}
  <div class="overlay">
    <div class="panel">
      <h2>// STANDBY //</h2>
      <p>{lobbyReason}</p>
      <p class="sub">GRID CAPACITY REACHED</p>
      <button on:click={handleRejoin}>RETRY CONNECTION</button>
      <button class="secondary" on:click={handleBackToSplash}>DISCONNECT</button>
    </div>
  </div>

{:else if screen === 'dead'}
  <div class="overlay">
    <div class="panel">
      <h2>// TERMINATED //</h2>
      {#if deathInfo}
        <p class="reason">{deathInfo.reason || 'SIGNAL LOST'}</p>
        <p>KILLS: {deathInfo.kills}</p>
      {/if}
      <button on:click={handleRejoin}>RECONNECT</button>
      <button class="secondary" on:click={handleBackToSplash}>DISCONNECT</button>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(10, 9, 8, 0.9);
    z-index: 100;
  }

  .panel {
    background: #0f0d0b;
    border: 1px solid #3a2e1e;
    padding: 40px;
    text-align: center;
    min-width: 320px;
    box-shadow: 0 0 40px rgba(199, 125, 58, 0.05);
  }

  h2 {
    font-size: 24px;
    color: #c77d3a;
    margin-bottom: 20px;
    letter-spacing: 6px;
    text-shadow: 0 0 20px rgba(199, 125, 58, 0.15);
  }

  p {
    margin-bottom: 8px;
    font-size: 14px;
    color: #6a5a45;
  }

  .sub {
    color: #4a3d2e;
    font-size: 12px;
    letter-spacing: 2px;
    margin-bottom: 24px;
  }

  .reason {
    color: #c77d3a;
    font-size: 15px;
    margin-bottom: 16px;
    letter-spacing: 1px;
  }

  button {
    display: block;
    width: 100%;
    padding: 12px 24px;
    margin-top: 12px;
    background: #2a1e10;
    color: #c77d3a;
    border: 1px solid #5a3d1e;
    font-family: 'Courier New', monospace;
    font-size: 14px;
    cursor: pointer;
    letter-spacing: 3px;
    text-transform: uppercase;
    transition: all 0.2s;
  }

  button:hover {
    background: #3a2a15;
    border-color: #c77d3a;
    box-shadow: 0 0 15px rgba(199, 125, 58, 0.1);
  }

  button.secondary {
    background: transparent;
    border: 1px solid #2a2015;
    color: #4a3d2e;
  }

  button.secondary:hover {
    border-color: #5a3d1e;
    color: #8a6530;
  }
</style>
