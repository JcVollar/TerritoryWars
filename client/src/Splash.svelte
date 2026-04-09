<script>
  export let onJoin;
  export let onSpectate;

  let name = '';

  function handleSubmit() {
    const trimmed = name.trim();
    if (trimmed.length > 0) {
      onJoin(trimmed);
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Enter') handleSubmit();
  }
</script>

<div class="splash">
  <div class="scanlines"></div>
  <div class="content">
    <h1>TERRITORY<br/>WARS</h1>
    <p class="tagline">// claim . conquer . survive //</p>

    <div class="input-group">
      <input
        type="text"
        bind:value={name}
        on:keydown={handleKeydown}
        placeholder="ENTER CALLSIGN..."
        maxlength="16"
        autofocus
      />
      <button on:click={handleSubmit} disabled={name.trim().length === 0}>
        CONNECT
      </button>
    </div>

    <button class="spectate" on:click={onSpectate}>OBSERVE</button>

    <div class="controls">
      <p>// INTERFACE //</p>
      <div class="keys">
        <span>WASD</span> or <span>ARROWS</span> to navigate
      </div>
    </div>

    <p class="dedication">dedicated to Maja</p>
  </div>
</div>

<style>
  .splash {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0a0908;
  }

  .scanlines {
    position: fixed;
    inset: 0;
    background: repeating-linear-gradient(
      0deg,
      rgba(0, 0, 0, 0.03) 0px,
      rgba(0, 0, 0, 0.03) 1px,
      transparent 1px,
      transparent 3px
    );
    pointer-events: none;
    z-index: 10;
  }

  .content {
    text-align: center;
    position: relative;
    z-index: 5;
  }

  h1 {
    font-size: 58px;
    color: #c77d3a;
    letter-spacing: 10px;
    line-height: 1.1;
    margin-bottom: 8px;
    text-shadow: 0 0 30px rgba(199, 125, 58, 0.2), 0 0 60px rgba(199, 125, 58, 0.05);
    font-family: 'Courier New', monospace;
  }

  .tagline {
    color: #5a4a35;
    font-size: 13px;
    letter-spacing: 5px;
    margin-bottom: 50px;
    text-transform: uppercase;
  }

  .input-group {
    display: flex;
    gap: 0;
    justify-content: center;
    margin-bottom: 24px;
  }

  input {
    padding: 14px 20px;
    background: #12100e;
    border: 1px solid #3a2e1e;
    color: #c7a06a;
    font-family: 'Courier New', monospace;
    font-size: 15px;
    width: 260px;
    outline: none;
    letter-spacing: 2px;
  }

  input::placeholder {
    color: #4a3d2e;
  }

  input:focus {
    border-color: #8a6530;
    box-shadow: 0 0 15px rgba(199, 125, 58, 0.1);
  }

  button {
    padding: 14px 24px;
    background: #2a1e10;
    color: #c77d3a;
    border: 1px solid #5a3d1e;
    font-family: 'Courier New', monospace;
    font-size: 15px;
    cursor: pointer;
    letter-spacing: 3px;
    text-transform: uppercase;
    transition: all 0.2s;
  }

  button:hover:not(:disabled) {
    background: #3a2a15;
    border-color: #c77d3a;
    box-shadow: 0 0 15px rgba(199, 125, 58, 0.15);
  }

  button:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .spectate {
    display: inline-block;
    padding: 10px 24px;
    margin-bottom: 40px;
    background: transparent;
    color: #5a4a35;
    border: 1px solid #2a2015;
    font-size: 12px;
  }

  .spectate:hover {
    border-color: #5a3d1e;
    color: #c77d3a;
  }

  .controls {
    color: #3a2e1e;
    font-size: 12px;
  }

  .controls p {
    letter-spacing: 4px;
    margin-bottom: 10px;
    color: #4a3d2e;
  }

  .keys span {
    color: #8a6530;
    padding: 3px 10px;
    border: 1px solid #2a2015;
    background: #12100e;
  }

  .dedication {
    margin-top: 40px;
    color: #4a3d2e;
    font-size: 11px;
    letter-spacing: 3px;
    font-style: italic;
  }
</style>
