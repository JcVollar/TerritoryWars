<script>
  import { onMount, onDestroy } from 'svelte';
  import Leaderboard from './Leaderboard.svelte';

  export let ws;
  export let playerId;
  export let gameConfig;
  export let spectating = false;

  let canvas;
  let ctx;
  let leaderboard = [];
  let claimedPct = 0;
  let gameState = null;
  let gridData = null; // Uint16Array of the grid
  let colorMap = {};
  let animFrame;
  let prevOnMessage = null;

  // Viewport — follow player, show a portion of the map
  let viewX = 0;
  let viewY = 0;

  // Spectate mode
  let followIndex = 0;   // index into players array to follow
  let freeCam = false;    // free camera vs follow a player
  const CAM_SPEED = 8;    // pixels per frame in free cam
  let keysHeld = { up: false, down: false, left: false, right: false };

  $: canvasW = gameConfig ? gameConfig.GRID_W * gameConfig.SQUARE_PX : 800;
  $: canvasH = gameConfig ? gameConfig.GRID_H * gameConfig.SQUARE_PX : 800;

  onMount(() => {
    ctx = canvas.getContext('2d');

    // Save the App-level onmessage handler so we can chain to it
    prevOnMessage = ws.onmessage;

    // Handle websocket messages — Game only cares about 'state' and binary grid
    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        const buf = event.data;
        const expectedFull = gameConfig ? gameConfig.GRID_W * gameConfig.GRID_H * 2 : 0;

        if (buf.byteLength === expectedFull) {
          // Full grid
          gridData = new Uint16Array(buf);
        } else if (buf.byteLength > 0 && buf.byteLength % 6 === 0) {
          // Delta update: [index(u32), value(u16)] × N
          if (!gridData && gameConfig) {
            gridData = new Uint16Array(gameConfig.GRID_W * gameConfig.GRID_H);
          }
          if (gridData) {
            const view = new DataView(buf);
            for (let off = 0; off < buf.byteLength; off += 6) {
              const idx = view.getUint32(off, true);
              const val = view.getUint16(off + 4, true);
              gridData[idx] = val;
            }
          }
        }
        return;
      }

      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === 'state') {
        gameState = msg;
        leaderboard = msg.leaderboard || [];
        claimedPct = msg.claimedPct || 0;
        colorMap = msg.colorMap || {};
      } else if (prevOnMessage) {
        // Pass non-state messages back to App handler (died, lobby, etc.)
        prevOnMessage(event);
      }
    };

    // Keyboard input
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('keyup', handleKeyup);

    // Start render loop
    render();
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
    window.removeEventListener('keyup', handleKeyup);
    if (animFrame) cancelAnimationFrame(animFrame);
  });

  function handleKeydown(e) {
    if (spectating) {
      handleSpectateKey(e);
      return;
    }
    let dir = null;
    switch (e.key) {
      case 'ArrowUp':    case 'w': case 'W': dir = 'up'; break;
      case 'ArrowDown':  case 's': case 'S': dir = 'down'; break;
      case 'ArrowLeft':  case 'a': case 'A': dir = 'left'; break;
      case 'ArrowRight': case 'd': case 'D': dir = 'right'; break;
    }
    if (dir && ws && ws.readyState === WebSocket.OPEN) {
      e.preventDefault();
      ws.send(JSON.stringify({ type: 'dir', dir }));
    }
  }

  function handleKeyup(e) {
    if (!spectating) return;
    switch (e.key) {
      case 'ArrowUp':    case 'w': case 'W': keysHeld.up = false; break;
      case 'ArrowDown':  case 's': case 'S': keysHeld.down = false; break;
      case 'ArrowLeft':  case 'a': case 'A': keysHeld.left = false; break;
      case 'ArrowRight': case 'd': case 'D': keysHeld.right = false; break;
    }
  }

  function handleSpectateKey(e) {
    e.preventDefault();
    switch (e.key) {
      // Tab = cycle through players
      case 'Tab':
        freeCam = false;
        if (gameState && gameState.players && gameState.players.length > 0) {
          followIndex = (followIndex + 1) % gameState.players.length;
        }
        break;
      // F = toggle free cam
      case 'f': case 'F':
        freeCam = !freeCam;
        break;
      // WASD / arrows = move free cam
      case 'ArrowUp':    case 'w': case 'W': keysHeld.up = true; break;
      case 'ArrowDown':  case 's': case 'S': keysHeld.down = true; break;
      case 'ArrowLeft':  case 'a': case 'A': keysHeld.left = true; break;
      case 'ArrowRight': case 'd': case 'D': keysHeld.right = true; break;
    }
  }

  function render() {
    if (!ctx || !gameConfig) {
      animFrame = requestAnimationFrame(render);
      return;
    }

    const { GRID_W, GRID_H, SQUARE_PX } = gameConfig;
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;

    // Camera
    if (spectating) {
      if (freeCam) {
        // Free camera — move with held keys
        if (keysHeld.up)    viewY -= CAM_SPEED;
        if (keysHeld.down)  viewY += CAM_SPEED;
        if (keysHeld.left)  viewX -= CAM_SPEED;
        if (keysHeld.right) viewX += CAM_SPEED;
      } else if (gameState && gameState.players && gameState.players.length > 0) {
        // Follow a player
        if (followIndex >= gameState.players.length) followIndex = 0;
        const target = gameState.players[followIndex];
        viewX = target.x * SQUARE_PX - screenW / 2;
        viewY = target.y * SQUARE_PX - screenH / 2;
      }
    } else {
      let myPlayer = null;
      if (gameState && gameState.players) {
        myPlayer = gameState.players.find(p => p.id === playerId);
      }
      if (myPlayer) {
        viewX = myPlayer.x * SQUARE_PX - screenW / 2;
        viewY = myPlayer.y * SQUARE_PX - screenH / 2;
      }
    }

    // Resize canvas to screen
    if (canvas.width !== screenW || canvas.height !== screenH) {
      canvas.width = screenW;
      canvas.height = screenH;
    }

    // Clear — pure black
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, screenW, screenH);

    // Draw grid cells with neon borders
    if (gridData && gridData.length === GRID_W * GRID_H) {
      const startX = Math.max(0, Math.floor(viewX / SQUARE_PX));
      const startY = Math.max(0, Math.floor(viewY / SQUARE_PX));
      const endX = Math.min(GRID_W, Math.ceil((viewX + screenW) / SQUARE_PX) + 1);
      const endY = Math.min(GRID_H, Math.ceil((viewY + screenH) / SQUARE_PX) + 1);

      // Batch by color — separate fill and border cells
      const colorBatches = {};  // interior cells
      const borderBatches = {}; // edge cells (neighbor is different owner)

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const owner = gridData[y * GRID_W + x];
          if (owner === 0) continue;
          const color = colorMap[owner] || '#222';

          // Check if this cell is on the border of the territory
          let isBorder = false;
          if (x > 0 && gridData[y * GRID_W + (x - 1)] !== owner) isBorder = true;
          if (!isBorder && x < GRID_W - 1 && gridData[y * GRID_W + (x + 1)] !== owner) isBorder = true;
          if (!isBorder && y > 0 && gridData[(y - 1) * GRID_W + x] !== owner) isBorder = true;
          if (!isBorder && y < GRID_H - 1 && gridData[(y + 1) * GRID_W + x] !== owner) isBorder = true;

          if (isBorder) {
            if (!borderBatches[color]) borderBatches[color] = [];
            borderBatches[color].push(x, y);
          } else {
            if (!colorBatches[color]) colorBatches[color] = [];
            colorBatches[color].push(x, y);
          }
        }
      }

      // Draw dark interior (all territory cells)
      for (const [color, coords] of Object.entries(colorBatches)) {
        ctx.fillStyle = darkenColor(color, 0.75);
        for (let i = 0; i < coords.length; i += 2) {
          const px = coords[i] * SQUARE_PX - viewX;
          const py = coords[i + 1] * SQUARE_PX - viewY;
          ctx.fillRect(px, py, SQUARE_PX, SQUARE_PX);
        }
      }
      for (const [color, coords] of Object.entries(borderBatches)) {
        ctx.fillStyle = darkenColor(color, 0.75);
        for (let i = 0; i < coords.length; i += 2) {
          const px = coords[i] * SQUARE_PX - viewX;
          const py = coords[i + 1] * SQUARE_PX - viewY;
          ctx.fillRect(px, py, SQUARE_PX, SQUARE_PX);
        }
      }

      // Draw thin neon border lines on edges
      for (const [color, coords] of Object.entries(borderBatches)) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        for (let i = 0; i < coords.length; i += 2) {
          const gx = coords[i];
          const gy = coords[i + 1];
          const px = gx * SQUARE_PX - viewX;
          const py = gy * SQUARE_PX - viewY;
          const owner = gridData[gy * GRID_W + gx];
          const r = 2; // corner radius

          // Draw border only on edges that face a different owner
          // Left edge
          if (gx === 0 || gridData[gy * GRID_W + (gx - 1)] !== owner) {
            ctx.beginPath();
            ctx.moveTo(px, py + r);
            ctx.lineTo(px, py + SQUARE_PX - r);
            ctx.stroke();
          }
          // Right edge
          if (gx === GRID_W - 1 || gridData[gy * GRID_W + (gx + 1)] !== owner) {
            ctx.beginPath();
            ctx.moveTo(px + SQUARE_PX, py + r);
            ctx.lineTo(px + SQUARE_PX, py + SQUARE_PX - r);
            ctx.stroke();
          }
          // Top edge
          if (gy === 0 || gridData[(gy - 1) * GRID_W + gx] !== owner) {
            ctx.beginPath();
            ctx.moveTo(px + r, py);
            ctx.lineTo(px + SQUARE_PX - r, py);
            ctx.stroke();
          }
          // Bottom edge
          if (gy === GRID_H - 1 || gridData[(gy + 1) * GRID_W + gx] !== owner) {
            ctx.beginPath();
            ctx.moveTo(px + r, py + SQUARE_PX);
            ctx.lineTo(px + SQUARE_PX - r, py + SQUARE_PX);
            ctx.stroke();
          }

          // Rounded corners — draw arc where two border edges meet
          const noLeft = gx === 0 || gridData[gy * GRID_W + (gx - 1)] !== owner;
          const noRight = gx === GRID_W - 1 || gridData[gy * GRID_W + (gx + 1)] !== owner;
          const noTop = gy === 0 || gridData[(gy - 1) * GRID_W + gx] !== owner;
          const noBottom = gy === GRID_H - 1 || gridData[(gy + 1) * GRID_W + gx] !== owner;

          ctx.beginPath();
          // Top-left corner
          if (noLeft && noTop) {
            ctx.arc(px + r, py + r, r, Math.PI, Math.PI * 1.5);
            ctx.stroke();
          }
          ctx.beginPath();
          // Top-right corner
          if (noRight && noTop) {
            ctx.arc(px + SQUARE_PX - r, py + r, r, Math.PI * 1.5, 0);
            ctx.stroke();
          }
          ctx.beginPath();
          // Bottom-left corner
          if (noLeft && noBottom) {
            ctx.arc(px + r, py + SQUARE_PX - r, r, Math.PI * 0.5, Math.PI);
            ctx.stroke();
          }
          ctx.beginPath();
          // Bottom-right corner
          if (noRight && noBottom) {
            ctx.arc(px + SQUARE_PX - r, py + SQUARE_PX - r, r, 0, Math.PI * 0.5);
            ctx.stroke();
          }
        }
      }
    }

    // Subtle grid lines
    if (SQUARE_PX >= 6) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
      ctx.lineWidth = 0.5;
      const startGX = Math.max(0, Math.floor(viewX / SQUARE_PX)) * SQUARE_PX - viewX;
      const startGY = Math.max(0, Math.floor(viewY / SQUARE_PX)) * SQUARE_PX - viewY;
      for (let gx = startGX; gx < screenW; gx += SQUARE_PX) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, screenH);
        ctx.stroke();
      }
      for (let gy = startGY; gy < screenH; gy += SQUARE_PX) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(screenW, gy);
        ctx.stroke();
      }
    }

    // Draw trails and players
    if (gameState && gameState.players) {
      for (const p of gameState.players) {
        if (p.trail && p.trail.length > 0) {
          // Trail: bright warm glow
          const trailColor = p.id === playerId ? '#f0d090' : lightenColor(p.color, 0.5);
          ctx.fillStyle = trailColor;
          ctx.globalAlpha = 0.9;
          for (const cell of p.trail) {
            const px = cell.x * SQUARE_PX - viewX;
            const py = cell.y * SQUARE_PX - viewY;
            ctx.fillRect(px, py, SQUARE_PX, SQUARE_PX);
          }
          ctx.globalAlpha = 1.0;

          // Subtle trail glow
          ctx.shadowColor = trailColor;
          ctx.shadowBlur = 4;
          const lastCell = p.trail[p.trail.length - 1];
          const lx = lastCell.x * SQUARE_PX - viewX;
          const ly = lastCell.y * SQUARE_PX - viewY;
          ctx.fillStyle = trailColor;
          ctx.fillRect(lx, ly, SQUARE_PX, SQUARE_PX);
          ctx.shadowBlur = 0;
        }

        // Player head — bright with glow
        const headX = p.x * SQUARE_PX - viewX;
        const headY = p.y * SQUARE_PX - viewY;
        const isMe = p.id === playerId;

        ctx.shadowColor = isMe ? '#f0d090' : p.color;
        ctx.shadowBlur = isMe ? 10 : 6;
        ctx.fillStyle = isMe ? '#f5e6c8' : lightenColor(p.color, 0.6);
        ctx.fillRect(headX - 1, headY - 1, SQUARE_PX + 2, SQUARE_PX + 2);
        ctx.shadowBlur = 0;

        // Name — warm amber text
        if (headX > -100 && headX < screenW + 100 && headY > -100 && headY < screenH + 100) {
          ctx.fillStyle = isMe ? '#f0d090' : 'rgba(200, 170, 120, 0.7)';
          ctx.font = `${isMe ? 11 : 9}px "Courier New", monospace`;
          ctx.textAlign = 'center';
          ctx.fillText(p.name, headX + SQUARE_PX / 2, headY - 6);
        }
      }
    }

    // Border walls — warm amber glow
    if (gameConfig) {
      ctx.strokeStyle = '#8a6530';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#c77d3a';
      ctx.shadowBlur = 8;
      ctx.strokeRect(-viewX, -viewY, GRID_W * SQUARE_PX, GRID_H * SQUARE_PX);
      ctx.shadowBlur = 0;
    }

    // Scanline overlay — subtle CRT effect
    ctx.fillStyle = 'rgba(0, 0, 0, 0.03)';
    for (let sy = 0; sy < screenH; sy += 3) {
      ctx.fillRect(0, sy, screenW, 1);
    }

    // Vignette — darken edges
    const vGrad = ctx.createRadialGradient(
      screenW / 2, screenH / 2, screenH * 0.35,
      screenW / 2, screenH / 2, screenH * 0.9
    );
    vGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vGrad.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = vGrad;
    ctx.fillRect(0, 0, screenW, screenH);

    // HUD — amber terminal style
    ctx.fillStyle = 'rgba(180, 140, 70, 0.5)';
    ctx.font = '11px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`MAP ${claimedPct.toFixed(1)}%`, 10, screenH - 12);

    if (spectating) {
      ctx.fillStyle = 'rgba(10, 9, 8, 0.8)';
      ctx.fillRect(0, 0, screenW, 32);
      ctx.fillStyle = '#b5884a';
      ctx.font = '12px "Courier New", monospace';
      ctx.textAlign = 'center';
      let followName = '';
      if (!freeCam && gameState && gameState.players && gameState.players.length > 0) {
        const idx = Math.min(followIndex, gameState.players.length - 1);
        followName = gameState.players[idx].name;
      }
      const label = freeCam
        ? 'FREE CAM // WASD move // Tab follow // F toggle'
        : `WATCHING: ${followName} // Tab next // F free cam`;
      ctx.fillText(label, screenW / 2, 21);
    }

    animFrame = requestAnimationFrame(render);
  }

  function lightenColor(hex, amount) {
    if (!hex || hex.startsWith('rgb') || hex.startsWith('hsl')) return hex;
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, ((num >> 16) & 0xff) + Math.floor(255 * amount));
    const g = Math.min(255, ((num >> 8) & 0xff) + Math.floor(255 * amount));
    const b = Math.min(255, (num & 0xff) + Math.floor(255 * amount));
    return `rgb(${r},${g},${b})`;
  }

  function darkenColor(hex, amount) {
    if (!hex || hex.startsWith('rgb') || hex.startsWith('hsl')) return hex;
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, Math.floor(((num >> 16) & 0xff) * (1 - amount)));
    const g = Math.max(0, Math.floor(((num >> 8) & 0xff) * (1 - amount)));
    const b = Math.max(0, Math.floor((num & 0xff) * (1 - amount)));
    return `rgb(${r},${g},${b})`;
  }
</script>

<div class="game-container">
  <canvas bind:this={canvas}></canvas>
  <Leaderboard {leaderboard} {playerId} />
</div>

<style>
  .game-container {
    position: fixed;
    inset: 0;
    background: #0a0908;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
