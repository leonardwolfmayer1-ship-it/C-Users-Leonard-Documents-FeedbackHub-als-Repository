(function () {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const playerHealthFill = document.getElementById("playerHealth");
  const enemyHealthFill = document.getElementById("enemyHealth");
  const specialFill = document.getElementById("specialCharge");
  const message = document.getElementById("message");
  const menuOverlay = document.getElementById("menuOverlay");
  const startStoryButton = document.getElementById("startStory");
  const startEndlessButton = document.getElementById("startEndless");
  const toggleAdminButton = document.getElementById("toggleAdmin");
  const modeLabel = document.getElementById("modeLabel");
  const roundLabel = document.getElementById("roundLabel");
  const highscoreLabel = document.getElementById("highscoreLabel");
  const adminLabel = document.getElementById("adminLabel");
  const debugLabel = document.getElementById("debugLabel");
  const phaseTwoThreshold = 0.45;
  const phaseThreeThreshold = 0.2;
  const baseEnemyMaxHealth = 280;
  const specialMaxCharge = 100;
  const endlessHighscoreKey = "the-hollow-knight-highscore";

  const arenaRadius = 13;
  const keys = Object.create(null);
  const projectiles = [];
  const lightningZones = [];
  const camera = {
    pitch: -0.42,
    minPitch: -0.9,
    maxPitch: -0.18,
    mouseSensitivityX: 0.0022,
    mouseSensitivityY: 0.0018,
    keyboardTurnSpeed: 3.8,
    maxLookStepX: 38,
    maxLookStepY: 30,
    pointerLocked: false,
    pendingLookX: 0,
    pendingLookY: 0,
  };

  const player = {
    x: 0,
    z: 6,
    y: 0,
    dir: Math.PI,
    health: 100,
    maxHealth: 100,
    cooldown: 0,
    dash: 0,
    attackTime: 0,
    hurtTime: 0,
    shotFlash: 0,
    specialCharge: 0,
  };

  const enemy = {
    x: 0,
    z: -5,
    y: 0,
    alive: true,
    dir: 0,
    health: baseEnemyMaxHealth,
    maxHealth: baseEnemyMaxHealth,
    cooldown: 0,
    swingTime: 0,
    phaseTime: 0,
    mode: "stalk",
    strafeDir: 1,
    phaseTwo: false,
    phaseThree: false,
    orbSpin: 0,
    orbCooldown: 0,
    transformTime: 0,
    transformFlash: 0,
    lightningCooldown: 0,
    lightningCast: 0,
  };

  let lastTime = performance.now();
  let gameOver = false;
  let gameStarted = false;
  let currentMode = "story";
  let endlessRound = 0;
  let roundTransitionTime = 0;
  let pendingTransitionMode = null;
  let endlessHighscore = 0;
  let adminMode = false;
  let adminOneShot = false;
  let adminInfiniteHealth = false;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function clampToArena(entity, margin) {
    const d = Math.hypot(entity.x, entity.z);
    const max = arenaRadius - margin;
    if (d > max) {
      entity.x = (entity.x / d) * max;
      entity.z = (entity.z / d) * max;
    }
  }

  function setMessage(text) {
    message.textContent = text;
    updateDebugUi();
  }

  function getDebugStateLabel() {
    if (!gameStarted) {
      return "menu";
    }
    if (gameOver) {
      return "gameover";
    }
    if (roundTransitionTime > 0 && pendingTransitionMode) {
      return `transition:${pendingTransitionMode}`;
    }
    if (!enemy.alive) {
      return "boss-down";
    }
    return "combat";
  }

  function updateDebugUi() {
    if (!debugLabel) {
      return;
    }

    const parts = [
      `Debug`,
      `state=${getDebugStateLabel()}`,
      `mode=${currentMode}`,
      `round=${currentMode === "endless" ? endlessRound : 0}`,
      `boss=${enemy.alive ? "alive" : "dead"}`,
      `transition=${roundTransitionTime > 0 ? roundTransitionTime.toFixed(2) : "0.00"}`,
      `pending=${pendingTransitionMode || "none"}`,
      `hp=${Math.ceil(player.health)}/${player.maxHealth}`,
    ];

    debugLabel.textContent = parts.join(" | ");
  }

  function loadHighscore() {
    try {
      const saved = Number.parseInt(window.localStorage.getItem(endlessHighscoreKey) || "0", 10);
      endlessHighscore = Number.isFinite(saved) ? Math.max(0, saved) : 0;
    } catch {
      endlessHighscore = 0;
    }
  }

  function saveHighscore() {
    try {
      window.localStorage.setItem(endlessHighscoreKey, String(endlessHighscore));
    } catch {
      // Ignore storage failures and keep the in-memory score.
    }
  }

  function updateHighscoreUi() {
    highscoreLabel.textContent = `Highscore ${endlessHighscore}`;
  }

  function updateAdminUi() {
    adminLabel.textContent = adminMode
      ? `Admin-Modus An${adminOneShot ? " | One Shot An" : " | One Shot Aus"}${adminInfiniteHealth ? " | Unendlich Leben An" : " | Unendlich Leben Aus"}`
      : "Admin-Modus Aus";
    toggleAdminButton.textContent = adminMode ? "Admin-Modus: An" : "Admin-Modus: Aus";
    toggleAdminButton.classList.toggle("active", adminMode);
  }

  function toggleAdminMode() {
    adminMode = !adminMode;
    if (!adminMode) {
      adminOneShot = false;
      adminInfiniteHealth = false;
    }
    updateAdminUi();
    setMessage(
      adminMode
        ? "Admin-Modus aktiv. Z schaltet One Shot um, U schaltet unendlich Leben um, Raketen sind staerker, T spawnt den naechsten Boss."
        : "Admin-Modus deaktiviert."
    );
  }

  function toggleAdminOneShot() {
    if (!adminMode) {
      return;
    }
    adminOneShot = !adminOneShot;
    updateAdminUi();
    setMessage(adminOneShot ? "Admin One Shot aktiviert." : "Admin One Shot deaktiviert.");
  }

  function toggleAdminInfiniteHealth() {
    if (!adminMode) {
      return;
    }
    adminInfiniteHealth = !adminInfiniteHealth;
    if (adminInfiniteHealth) {
      player.health = player.maxHealth;
      updateBars();
    }
    updateAdminUi();
    setMessage(adminInfiniteHealth ? "Unendlich Leben aktiviert." : "Unendlich Leben deaktiviert.");
  }

  function maybeUpdateHighscore(round) {
    if (round > endlessHighscore) {
      endlessHighscore = round;
      saveHighscore();
      updateHighscoreUi();
    }
  }

  function clearPressedKeys() {
    Object.keys(keys).forEach((key) => {
      keys[key] = false;
    });
  }

  function clearEndlessRoundTimeout() {
    pendingTransitionMode = null;
  }

  function clearTransientCombatState() {
    clearEndlessRoundTimeout();
    roundTransitionTime = 0;
    projectiles.length = 0;
    lightningZones.length = 0;
  }

  function queueRoundTransition(mode, duration, text) {
    pendingTransitionMode = mode;
    roundTransitionTime = duration;
    setMessage(text);
  }

  function showMenu() {
    if (document.pointerLockElement === canvas) {
      document.exitPointerLock();
    }
    menuOverlay.classList.remove("hidden");
  }

  function hideMenu() {
    menuOverlay.classList.add("hidden");
  }

  function updateMetaUi() {
    modeLabel.textContent = currentMode === "endless" ? "Endloser Modus" : "Bosskampf";
    roundLabel.textContent = currentMode === "endless" ? `Runde ${endlessRound}` : "Story Modus";
    updateHighscoreUi();
    updateAdminUi();
    updateDebugUi();
  }

  function updateBars() {
    playerHealthFill.style.width = `${Math.max(0, (player.health / player.maxHealth) * 100)}%`;
    enemyHealthFill.style.width = `${Math.max(0, (enemy.health / enemy.maxHealth) * 100)}%`;
    specialFill.style.width = `${Math.max(0, (player.specialCharge / specialMaxCharge) * 100)}%`;
    updateDebugUi();
  }

  function setGameOverState(text) {
    clearTransientCombatState();
    if (currentMode === "endless") {
      maybeUpdateHighscore(endlessRound);
    }
    gameOver = true;
    enemy.alive = false;
    clearPressedKeys();
    showMenu();
    setMessage(text);
  }

  function configureEnemyForRound(round) {
    const bossHealth = currentMode === "endless" ? baseEnemyMaxHealth + (round - 1) * 45 : baseEnemyMaxHealth;
    enemy.maxHealth = bossHealth;
    enemy.health = bossHealth;
  }

  function resetPlayerForRound(options = {}) {
    const { fullReset = false, healAmount = 0 } = options;

    player.x = 0;
    player.z = 6;
    player.dir = Math.PI;
    player.health = fullReset ? player.maxHealth : Math.min(player.maxHealth, player.health + healAmount);
    player.cooldown = 0;
    player.dash = 0;
    player.attackTime = 0;
    player.hurtTime = 0;
    player.shotFlash = 0;
    if (fullReset) {
      player.specialCharge = 0;
    }

    camera.pitch = -0.42;
    camera.pendingLookX = 0;
    camera.pendingLookY = 0;
  }

  function resetEnemyForRound(round, options = {}) {
    const { transformIntro = false } = options;

    enemy.x = 0;
    enemy.z = -5;
    enemy.alive = true;
    enemy.dir = 0;
    configureEnemyForRound(round);
    enemy.cooldown = 0;
    enemy.swingTime = 0;
    enemy.phaseTime = 0;
    enemy.mode = "stalk";
    enemy.strafeDir = 1;
    enemy.phaseTwo = false;
    enemy.phaseThree = false;
    enemy.orbSpin = 0;
    enemy.orbCooldown = 0;
    enemy.transformTime = transformIntro ? 1.1 : 0;
    enemy.transformFlash = transformIntro ? 0.9 : 0;
    enemy.lightningCooldown = 0;
    enemy.lightningCast = 0;
  }

  function resetGame(mode = currentMode) {
    currentMode = mode;
    gameStarted = true;
    endlessRound = currentMode === "endless" ? 1 : 0;
    clearTransientCombatState();
    clearPressedKeys();

    resetPlayerForRound({ fullReset: true });
    resetEnemyForRound(Math.max(1, endlessRound));

    gameOver = false;
    hideMenu();
    updateMetaUi();
    updateBars();
    setMessage(
      currentMode === "endless"
        ? "Endlosmodus. Besiege den Boss und ueberlebe jede neue Runde."
        : "Das Spiel laeuft. Du hast Fernkampf. Schiess den Boss mit F ab."
    );
  }

  function startNextEndlessRound() {
    if (!gameStarted || currentMode !== "endless") {
      return;
    }

    clearTransientCombatState();
    clearPressedKeys();
    endlessRound = Math.max(1, endlessRound + 1);
    resetPlayerForRound({ healAmount: 28 });
    resetEnemyForRound(endlessRound, { transformIntro: true });

    gameOver = false;
    hideMenu();
    updateMetaUi();
    updateBars();
    setMessage(`Runde ${endlessRound}. Der Boss kehrt staerker zurueck.`);
  }

  function spawnAdminBoss() {
    if (!adminMode || !gameStarted) {
      return;
    }
    if (currentMode === "endless") {
      startNextEndlessRound();
      setMessage(`Admin-Modus. Boss fuer Runde ${endlessRound} gespawnt.`);
      return;
    }

    resetEnemyForRound(1);
    projectiles.length = 0;
    lightningZones.length = 0;
    gameOver = false;
    hideMenu();
    updateBars();
    setMessage("Admin-Modus. Neuer Boss gespawnt.");
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  function dealDamageToEnemy(amount) {
    if (!enemy.alive || enemy.transformTime > 0 || enemy.lightningCast > 0) {
      return;
    }
    enemy.health = Math.max(0, enemy.health - amount);
    if (!enemy.phaseTwo && enemy.health <= enemy.maxHealth * phaseTwoThreshold) {
      enemy.phaseTwo = true;
      enemy.orbCooldown = 1.2;
      enemy.phaseTime = 0;
      enemy.transformTime = 1.8;
      enemy.transformFlash = 1;
      setMessage("Phase 2. Der Boss verwandelt sich und beschwoert Kugeln.");
    }
    if (!enemy.phaseThree && enemy.health <= enemy.maxHealth * phaseThreeThreshold) {
      enemy.phaseThree = true;
      enemy.orbCooldown = 0.5;
      enemy.lightningCooldown = 1.2;
      enemy.transformTime = 2.1;
      enemy.transformFlash = 1;
      setMessage("Phase 3. Neon-Blitze markieren den Boden und schlagen auf dich ein.");
    }
    updateBars();
    if (enemy.health <= 0) {
      enemy.alive = false;
      projectiles.length = 0;
      lightningZones.length = 0;
      if (currentMode === "endless") {
        maybeUpdateHighscore(endlessRound);
        queueRoundTransition("endless", 1.4, `Boss besiegt. Runde ${endlessRound + 1} startet gleich.`);
      } else {
        clearEndlessRoundTimeout();
        gameOver = false;
        hideMenu();
        queueRoundTransition("story", 1.2, "Sieg. Ein neuer Boss erscheint gleich.");
      }
    }
  }

  function dealDamageToPlayer(amount) {
    if (adminMode && adminInfiniteHealth) {
      player.health = player.maxHealth;
      updateBars();
      return;
    }
    if (player.hurtTime > 0 || gameOver) {
      return;
    }
    player.health = Math.max(0, player.health - amount);
    player.hurtTime = 0.55;
    updateBars();
    if (player.health <= 0) {
      setGameOverState("Niederlage. Der Boss hat dich getroffen. Waehle unten einen Neustart.");
    }
  }

  function addSpecialCharge(amount) {
    if (gameOver || !gameStarted || roundTransitionTime > 0) {
      return;
    }
    player.specialCharge = Math.min(specialMaxCharge, player.specialCharge + amount);
    updateBars();
  }

  function fireSpecialVolley() {
    if (player.specialCharge < specialMaxCharge || !enemy.alive || enemy.health <= 0 || roundTransitionTime > 0 || gameOver) {
      return;
    }

    player.specialCharge = 0;
    player.cooldown = Math.max(player.cooldown, 0.28);
    player.attackTime = 0.3;
    player.shotFlash = 0.2;

    for (let i = 0; i < 3; i += 1) {
      const sideOffset = (i - 1) * 0.45;
      projectiles.push({
        x: player.x + Math.sin(player.dir) * 0.9 + Math.cos(player.dir) * sideOffset,
        z: player.z + Math.cos(player.dir) * 0.9 - Math.sin(player.dir) * sideOffset,
        y: 1.7 + i * 0.12,
        dir: player.dir + sideOffset * 0.12,
        speed: 7.4 + i * 0.55,
        life: 2.6,
        radius: 0.42,
        owner: "player",
        type: "missile",
        damage: adminMode ? 80 : 22,
        turnSpeed: 4.8,
      });
    }

    updateBars();
    setMessage("Drei Neon-Raketen schiessen auf den Boss.");
  }

  function attack() {
    if (player.cooldown > 0 || gameOver || !gameStarted || roundTransitionTime > 0) {
      return;
    }
    player.cooldown = 0.22;
    player.attackTime = 0.12;
    player.shotFlash = 0.08;
    const baseDamage = adminOneShot ? enemy.maxHealth : 12;
    projectiles.push({
      x: player.x + Math.sin(player.dir) * 0.9,
      z: player.z + Math.cos(player.dir) * 0.9,
      y: 1.95,
      dir: player.dir,
      speed: 16,
      life: 1.3,
      radius: 0.32,
      owner: "player",
      damage: baseDamage,
    });
    setMessage("Schuss abgefeuert.");
  }

  function getEnemyOrbPositions() {
    const positions = [];
    if (!enemy.alive || !enemy.phaseTwo || gameOver) {
      return positions;
    }

    const orbCount = 4;
    const orbitRadius = 1.9;
    for (let i = 0; i < orbCount; i += 1) {
      const angle = enemy.orbSpin + (i / orbCount) * Math.PI * 2;
      positions.push({
        x: enemy.x + Math.sin(angle) * orbitRadius,
        y: 2.25 + Math.sin(angle * 2.2) * 0.22,
        z: enemy.z + Math.cos(angle) * orbitRadius,
      });
    }
    return positions;
  }

  function fireOrbVolley() {
    const orbs = getEnemyOrbPositions();
    if (orbs.length === 0) {
      return;
    }

    const selected = [0, 2].map((index) => orbs[index]);
    for (const orb of selected) {
      const dx = player.x - orb.x;
      const dz = player.z - orb.z;
      const dir = Math.atan2(dx, dz);
      projectiles.push({
        x: orb.x,
        y: orb.y,
        z: orb.z,
        dir,
        speed: 9.5,
        life: 2.4,
        radius: 0.38,
        owner: "enemy",
        damage: 12,
      });
    }
    setMessage("Phase 2. Die Kugeln feuern auf dich.");
  }

  function restartIfNeeded() {
    if (keys.KeyR) {
      resetGame();
    }
  }

  function startLightningAttack() {
    enemy.lightningCast = 1.45;
    enemy.lightningCooldown = 3.2;
    enemy.cooldown = Math.max(enemy.cooldown, 1.1);
    lightningZones.length = 0;

    for (let i = 0; i < 3; i += 1) {
      const offsetAngle = i * 2.1 + performance.now() * 0.001;
      const offsetRadius = i === 0 ? 0 : 1.1 + i * 0.55;
      const zone = {
        x: player.x + Math.sin(offsetAngle) * offsetRadius,
        z: player.z + Math.cos(offsetAngle) * offsetRadius,
        radius: 1.15 + i * 0.18,
        warn: 0.78 + i * 0.08,
        flash: 0.2,
        hit: false,
      };
      clampToArena(zone, zone.radius + 0.4);
      lightningZones.push(zone);
    }

    setMessage("Phase 3. Rote Bereiche warnen dich vor den Neon-Blitzen.");
  }

  function updatePlayer(dt) {
    player.cooldown = Math.max(0, player.cooldown - dt);
    player.dash = Math.max(0, player.dash - dt);
    player.attackTime = Math.max(0, player.attackTime - dt);
    player.hurtTime = Math.max(0, player.hurtTime - dt);
    player.shotFlash = Math.max(0, player.shotFlash - dt);
    addSpecialCharge(dt * 18);

    if (gameOver) {
      restartIfNeeded();
      return;
    }

    if (!gameStarted || roundTransitionTime > 0) {
      return;
    }

    if (camera.pendingLookX !== 0 || camera.pendingLookY !== 0) {
      const lookX = Math.max(-camera.maxLookStepX, Math.min(camera.maxLookStepX, camera.pendingLookX));
      const lookY = Math.max(-camera.maxLookStepY, Math.min(camera.maxLookStepY, camera.pendingLookY));

      player.dir -= lookX * camera.mouseSensitivityX;
      camera.pitch = Math.max(
        camera.minPitch,
        Math.min(camera.maxPitch, camera.pitch - lookY * camera.mouseSensitivityY)
      );
      camera.pendingLookX = 0;
      camera.pendingLookY = 0;
    }

    if (keys.KeyQ || keys.ArrowLeft) player.dir += dt * camera.keyboardTurnSpeed;
    if (keys.KeyE || keys.ArrowRight) player.dir -= dt * camera.keyboardTurnSpeed;

    let moveX = 0;
    let moveZ = 0;
    if (keys.KeyW) moveZ += 1;
    if (keys.KeyS) moveZ -= 1;
    if (keys.KeyA) moveX -= 1;
    if (keys.KeyD) moveX += 1;

    if (keys.KeyF) {
      attack();
    }

    if (moveX !== 0 || moveZ !== 0) {
      const len = Math.hypot(moveX, moveZ);
      moveX /= len;
      moveZ /= len;
      const speed = keys.ShiftLeft ? 9 : 5.5;
      const dashBoost = keys.Space && player.dash <= 0 ? 8 : 0;
      if (dashBoost > 0) {
        player.dash = 0.8;
      }
      const finalSpeed = speed + dashBoost;
      const sin = Math.sin(player.dir);
      const cos = Math.cos(player.dir);
      const worldX = moveX * cos + moveZ * sin;
      const worldZ = moveZ * cos - moveX * sin;
      player.x += worldX * dt * finalSpeed;
      player.z += worldZ * dt * finalSpeed;
      clampToArena(player, 0.8);
    }
  }

  function updateEnemy(dt) {
    if (!enemy.alive) {
      return;
    }
    enemy.cooldown = Math.max(0, enemy.cooldown - dt);
    enemy.swingTime = Math.max(0, enemy.swingTime - dt);
    enemy.phaseTime -= dt;
    enemy.orbCooldown = Math.max(0, enemy.orbCooldown - dt);
    enemy.lightningCooldown = Math.max(0, enemy.lightningCooldown - dt);
    enemy.orbSpin += dt * (enemy.phaseTwo ? 2.8 : 0);
    enemy.transformFlash = Math.max(0, enemy.transformFlash - dt * 1.35);

    if (gameOver) {
      restartIfNeeded();
      return;
    }

    if (!gameStarted || roundTransitionTime > 0) {
      return;
    }

    if (enemy.transformTime > 0) {
      enemy.transformTime = Math.max(0, enemy.transformTime - dt);
      enemy.dir += dt * 3.8;
      if (enemy.transformTime === 0) {
        enemy.orbCooldown = 0.25;
        setMessage(
          enemy.phaseThree
            ? "Phase 3. Kugeln und Neon-Blitze jagen dich jetzt gleichzeitig."
            : "Phase 2. Die Kugeln umkreisen den Boss und feuern auf dich."
        );
      }
      return;
    }

    if (roundTransitionTime > 0) {
      return;
    }

    const dx = player.x - enemy.x;
    const dz = player.z - enemy.z;
    const dist = Math.hypot(dx, dz);
    const ang = Math.atan2(dx, dz);
    enemy.dir = ang;

    if (enemy.phaseTime <= 0) {
      enemy.phaseTime = 1 + Math.random() * 0.9;
      enemy.mode = dist > 4.5 ? "rush" : Math.random() > 0.5 ? "strafe" : "stalk";
      enemy.strafeDir = Math.random() > 0.5 ? 1 : -1;
    }

    const nx = dist === 0 ? 0 : dx / dist;
    const nz = dist === 0 ? 0 : dz / dist;
    let speed = 2.4;

    if (enemy.lightningCast > 0) {
      enemy.lightningCast = Math.max(0, enemy.lightningCast - dt);
      enemy.dir += dt * 2.2;
      if (enemy.phaseTwo && enemy.orbCooldown <= 0) {
        enemy.orbCooldown = enemy.phaseThree ? 1 : 1.4;
        fireOrbVolley();
      }
      return;
    }

    if (enemy.phaseThree) {
      if (dist < 6.8) {
        enemy.x -= nx * dt * 3.1;
        enemy.z -= nz * dt * 3.1;
      } else if (dist > 9.8) {
        enemy.x += nx * dt * 4.1;
        enemy.z += nz * dt * 4.1;
      } else {
        enemy.x += nz * dt * enemy.strafeDir * 3.35;
        enemy.z -= nx * dt * enemy.strafeDir * 3.35;
      }
    } else if (enemy.phaseTwo) {
      if (dist < 5.6) {
        enemy.x -= nx * dt * 2.6;
        enemy.z -= nz * dt * 2.6;
      } else if (dist > 8.5) {
        enemy.x += nx * dt * 3.7;
        enemy.z += nz * dt * 3.7;
      } else {
        enemy.x += nz * dt * enemy.strafeDir * 2.8;
        enemy.z -= nx * dt * enemy.strafeDir * 2.8;
      }
    } else if (enemy.mode === "rush") {
      speed = 4.5;
      enemy.x += nx * dt * speed;
      enemy.z += nz * dt * speed;
    } else if (enemy.mode === "strafe") {
      enemy.x += nx * dt * 1.6 + nz * dt * enemy.strafeDir * 2.3;
      enemy.z += nz * dt * 1.6 - nx * dt * enemy.strafeDir * 2.3;
    } else {
      enemy.x += nx * dt * speed;
      enemy.z += nz * dt * speed;
    }

    clampToArena(enemy, 1.1);

    if (enemy.phaseTwo && enemy.orbCooldown <= 0) {
      enemy.orbCooldown = enemy.phaseThree ? 1.1 : 1.6;
      enemy.strafeDir = Math.random() > 0.5 ? 1 : -1;
      fireOrbVolley();
    }

    if (enemy.phaseThree && enemy.lightningCooldown <= 0) {
      startLightningAttack();
      return;
    }

    if (dist < 2.6 && enemy.cooldown <= 0) {
      enemy.cooldown = 1.2;
      enemy.swingTime = 0.35;
      dealDamageToPlayer(16);
      setMessage(
        enemy.phaseThree
          ? "Nahkampf trifft. In Phase 3 musst du Sense, Kugeln und Blitzen ausweichen."
          : enemy.phaseTwo
            ? "Nahkampf trifft. In Phase 2 musst du Sense und Kugeln ausweichen."
            : "Der Boss schwingt die Sense. Halt Abstand und schiess mit F."
      );
    }
  }

  function updateLightning(dt) {
    if (roundTransitionTime > 0) {
      lightningZones.length = 0;
      return;
    }
    for (let i = lightningZones.length - 1; i >= 0; i -= 1) {
      const zone = lightningZones[i];
      zone.warn -= dt;

      if (!zone.hit && zone.warn <= 0) {
        zone.hit = true;
        zone.flash = 0.18;
        if (Math.hypot(player.x - zone.x, player.z - zone.z) <= zone.radius) {
          dealDamageToPlayer(20);
          if (!gameOver) {
            setMessage("Ein Neon-Blitz hat dich getroffen.");
          }
        }
      }

      if (zone.hit) {
        zone.flash -= dt;
        if (zone.flash <= 0) {
          lightningZones.splice(i, 1);
        }
      }
    }
  }

  function updateProjectiles(dt) {
    if (roundTransitionTime > 0) {
      projectiles.length = 0;
      return;
    }
    for (let i = projectiles.length - 1; i >= 0; i -= 1) {
      const shot = projectiles[i];
      shot.life -= dt;
      if (shot.type === "missile" && enemy.alive && enemy.health > 0) {
        const desiredDir = Math.atan2(enemy.x - shot.x, enemy.z - shot.z);
        let dirDiff = desiredDir - shot.dir;
        while (dirDiff > Math.PI) dirDiff -= Math.PI * 2;
        while (dirDiff < -Math.PI) dirDiff += Math.PI * 2;
        const maxTurn = (shot.turnSpeed || 0) * dt;
        shot.dir += Math.max(-maxTurn, Math.min(maxTurn, dirDiff));
        shot.y += Math.max(-0.7, Math.min(0.7, 2.1 - shot.y)) * dt * 3.6;
      }
      shot.x += Math.sin(shot.dir) * shot.speed * dt;
      shot.z += Math.cos(shot.dir) * shot.speed * dt;

      if (Math.hypot(shot.x, shot.z) > arenaRadius - 0.4 || shot.life <= 0) {
        projectiles.splice(i, 1);
        continue;
      }

      if (enemy.alive && shot.owner === "player" && Math.hypot(shot.x - enemy.x, shot.z - enemy.z) < 1.1) {
        dealDamageToEnemy(shot.damage || 12);
        addSpecialCharge(shot.type === "missile" ? 12 : 7);
        projectiles.splice(i, 1);
        setMessage(shot.type === "missile" ? "Raketen-Treffer." : "Treffer mit Fernkampf.");
        continue;
      }

      if (shot.owner === "enemy" && Math.hypot(shot.x - player.x, shot.z - player.z) < 0.95) {
        dealDamageToPlayer(shot.damage || 10);
        projectiles.splice(i, 1);
        if (!gameOver) {
          setMessage("Du wurdest von einer Kugel getroffen.");
        }
      }
    }
  }

  function projectPoint(x, y, z, cam) {
    const rx = x - cam.x;
    const ry = y - cam.y;
    const rz = z - cam.z;

    const sin = Math.sin(-cam.dir);
    const cos = Math.cos(-cam.dir);
    const cx = rx * cos - rz * sin;
    const cz = rx * sin + rz * cos;

    const pitchCos = Math.cos(cam.pitch);
    const pitchSin = Math.sin(cam.pitch);
    const cy = ry * pitchCos - cz * pitchSin;
    const dz = ry * pitchSin + cz * pitchCos;

    if (dz < 0.1) {
      return null;
    }

    const scale = cam.fov / dz;
    return {
      x: canvas.width * 0.5 + cx * scale,
      y: canvas.height * 0.5 - cy * scale,
      scale,
      depth: dz,
    };
  }

  function getCamera() {
    return {
      x: player.x - Math.sin(player.dir) * 7,
      y: 6,
      z: player.z - Math.cos(player.dir) * 7,
      dir: player.dir,
      pitch: camera.pitch,
      fov: Math.min(canvas.width, canvas.height) * 0.95,
    };
  }

  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, "#122033");
    sky.addColorStop(0.55, "#0d1622");
    sky.addColorStop(1, "#081019");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (enemy.transformFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${enemy.transformFlash * 0.2})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  function drawArena(cam) {
    const center = projectPoint(0, 0, 0, cam);
    const edge = projectPoint(arenaRadius, 0, 0, cam);
    if (!center || !edge) {
      return;
    }

    const radius = Math.abs(edge.x - center.x);
    const depthFade = Math.max(0.35, 1 - center.depth / 40);

    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.scale(1, 0.42);

    const glow = ctx.createRadialGradient(0, 0, radius * 0.2, 0, 0, radius * 1.2);
    glow.addColorStop(0, `rgba(17, 42, 61, ${0.95 * depthFade})`);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.15, 0, Math.PI * 2);
    ctx.fill();

    const floor = ctx.createRadialGradient(-radius * 0.18, -radius * 0.22, radius * 0.12, 0, 0, radius);
    floor.addColorStop(0, "#243547");
    floor.addColorStop(0.32, "#162433");
    floor.addColorStop(0.68, "#0d1722");
    floor.addColorStop(1, "#070d14");
    ctx.fillStyle = floor;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();

    const innerShade = ctx.createRadialGradient(0, 0, radius * 0.12, 0, 0, radius * 0.92);
    innerShade.addColorStop(0, "rgba(255,255,255,0.08)");
    innerShade.addColorStop(0.5, "rgba(255,255,255,0.02)");
    innerShade.addColorStop(1, "rgba(0,0,0,0.16)");
    ctx.fillStyle = innerShade;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.96, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(118, 144, 168, 0.22)";
    ctx.lineWidth = Math.max(1.2, radius * 0.008);
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.arc(0, 0, radius * (0.26 + i * 0.19), 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(205, 225, 242, 0.12)";
    ctx.lineWidth = Math.max(1, radius * 0.006);
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * radius * 0.18, Math.sin(angle) * radius * 0.18);
      ctx.lineTo(Math.cos(angle) * radius * 0.88, Math.sin(angle) * radius * 0.88);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = Math.max(0.8, radius * 0.004);
    for (let i = 0; i < 7; i += 1) {
      const angle = 0.5 + i * 0.84;
      const startR = radius * (0.24 + (i % 3) * 0.08);
      const midR = radius * (0.46 + (i % 2) * 0.12);
      const endR = radius * (0.72 + ((i + 1) % 2) * 0.08);
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * startR, Math.sin(angle) * startR);
      ctx.lineTo(Math.cos(angle + 0.11) * midR, Math.sin(angle + 0.11) * midR);
      ctx.lineTo(Math.cos(angle - 0.08) * endR, Math.sin(angle - 0.08) * endR);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(110, 243, 255, 0.55)";
    ctx.lineWidth = Math.max(3, radius * 0.03);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.94, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.32)";
    ctx.lineWidth = Math.max(1.2, radius * 0.008);
    ctx.setLineDash([radius * 0.035, radius * 0.045]);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.985, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    for (let i = 0; i < 18; i += 1) {
      const angle = (i / 18) * Math.PI * 2;
      const px = Math.cos(angle) * radius * 0.98;
      const py = Math.sin(angle) * radius * 0.98;
      ctx.fillStyle = i % 2 === 0 ? "rgba(238, 246, 255, 0.26)" : "rgba(98, 122, 146, 0.24)";
      ctx.beginPath();
      ctx.arc(px, py, radius * 0.024, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawPillarWorld(cam) {
    for (let i = 0; i < 18; i += 1) {
      const angle = (i / 18) * Math.PI * 2;
      const x = Math.sin(angle) * (arenaRadius + 6);
      const z = Math.cos(angle) * (arenaRadius + 6);
      drawVerticalGlow(cam, x, z, 4 + (i % 3) * 1.4, i % 2 === 0 ? "#1c2d45" : "#17303a");
    }
  }

  function drawVerticalGlow(cam, x, z, height, color) {
    const base = projectPoint(x, 0, z, cam);
    const top = projectPoint(x, height, z, cam);
    if (!base || !top) return;
    const width = Math.max(8, 160 / base.depth);
    ctx.fillStyle = color;
    ctx.fillRect(base.x - width / 2, top.y, width, base.y - top.y);
  }

  function roundedRect(x, y, width, height, radius) {
    const r = Math.min(radius, width * 0.5, height * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawCharacter(entity, cam, style) {
    const base = projectPoint(entity.x, 0, entity.z, cam);
    const torso = projectPoint(entity.x, 2.3, entity.z, cam);
    const head = projectPoint(entity.x, 3.6, entity.z, cam);
    if (!base || !torso || !head) {
      return;
    }

    const scale = 360 / torso.depth;
    const bodyW = scale * 0.82;
    const bodyH = scale * 1.34;
    const legH = scale * 1.02;
    const headR = scale * 0.38;
    const hitFlash = style.hit > 0 ? Math.floor(style.hit * 200) : 0;
    const shoulderY = torso.y + bodyH * 0.02;
    const hipY = torso.y + bodyH * 0.92;
    const leftLegX = base.x - bodyW * 0.24;
    const rightLegX = base.x + bodyW * 0.24;
    const leftArmX = torso.x - bodyW * 0.72;
    const rightArmX = torso.x + bodyW * 0.72;
    const handY = torso.y + bodyH * 0.9;

    ctx.save();

    if (style.shadow !== false) {
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(base.x, base.y + 6, bodyW * 0.8, bodyW * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = style.legColor;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(4, bodyW * 0.24);
    ctx.beginPath();
    ctx.moveTo(leftLegX, hipY);
    ctx.lineTo(leftLegX - bodyW * 0.08, hipY + legH);
    ctx.moveTo(rightLegX, hipY);
    ctx.lineTo(rightLegX + bodyW * 0.08, hipY + legH);
    ctx.stroke();

    ctx.fillStyle = style.bootColor || style.legColor;
    roundedRect(leftLegX - bodyW * 0.18, hipY + legH - scale * 0.06, bodyW * 0.28, scale * 0.16, scale * 0.05);
    ctx.fill();
    roundedRect(rightLegX - bodyW * 0.1, hipY + legH - scale * 0.06, bodyW * 0.28, scale * 0.16, scale * 0.05);
    ctx.fill();

    if (style.type === "enemy") {
      const gradient = ctx.createLinearGradient(
        torso.x - bodyW * 0.7,
        torso.y,
        torso.x + bodyW * 0.7,
        torso.y + bodyH
      );
      gradient.addColorStop(0, "#1b0610");
      gradient.addColorStop(0.25, "#4f0c26");
      gradient.addColorStop(0.55, "#12040d");
      gradient.addColorStop(0.8, "#7c1037");
      gradient.addColorStop(1, "#26030e");
      ctx.fillStyle = gradient;
      ctx.shadowBlur = Math.max(ctx.shadowBlur || 0, 18);
      ctx.shadowColor = "rgba(255, 30, 90, 0.45)";

      if (enemy.transformTime > 0) {
        const pulse = 0.65 + Math.sin(performance.now() * 0.03) * 0.25;
        ctx.shadowBlur = 34 * pulse;
        ctx.shadowColor = "rgba(255,255,255,0.95)";
      } else if (enemy.lightningCast > 0) {
        const pulse = 0.7 + Math.sin(performance.now() * 0.04) * 0.25;
        ctx.shadowBlur = 28 * pulse;
        ctx.shadowColor = "rgba(80,255,255,0.95)";
      }
    } else {
      ctx.fillStyle = style.bodyColor;
    }

    roundedRect(torso.x - bodyW * 0.62, torso.y - bodyH * 0.14, bodyW * 1.24, bodyH, bodyW * 0.28);
    ctx.fill();

    if (style.type === "player") {
      ctx.fillStyle = "rgba(22, 34, 48, 0.5)";
      roundedRect(torso.x - bodyW * 0.42, torso.y + bodyH * 0.02, bodyW * 0.84, bodyH * 0.58, bodyW * 0.18);
      ctx.fill();
      ctx.fillStyle = "rgba(220, 242, 255, 0.28)";
      roundedRect(torso.x - bodyW * 0.18, torso.y - bodyH * 0.04, bodyW * 0.36, bodyH * 0.34, bodyW * 0.12);
      ctx.fill();
    } else {
      ctx.fillStyle = "rgba(0,0,0,0.34)";
      ctx.beginPath();
      ctx.moveTo(torso.x, torso.y + bodyH * 0.12);
      ctx.lineTo(torso.x - bodyW * 0.18, torso.y + bodyH * 0.68);
      ctx.lineTo(torso.x + bodyW * 0.18, torso.y + bodyH * 0.68);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "rgba(255, 40, 110, 0.14)";
      ctx.beginPath();
      ctx.moveTo(torso.x, torso.y + bodyH * 0.16);
      ctx.lineTo(torso.x - bodyW * 0.13, torso.y + bodyH * 0.46);
      ctx.lineTo(torso.x, torso.y + bodyH * 0.62);
      ctx.lineTo(torso.x + bodyW * 0.13, torso.y + bodyH * 0.46);
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = style.armColor;
    ctx.lineWidth = Math.max(4, bodyW * 0.2);
    ctx.beginPath();
    ctx.moveTo(leftArmX, shoulderY);
    ctx.lineTo(leftArmX - bodyW * 0.12, handY);
    ctx.moveTo(rightArmX, shoulderY);
    ctx.lineTo(rightArmX + bodyW * 0.12, handY);
    ctx.stroke();

    const headGradient = ctx.createRadialGradient(
      head.x - headR * 0.22,
      head.y - headR * 0.28,
      headR * 0.15,
      head.x,
      head.y,
      headR
    );
    headGradient.addColorStop(0, style.headHighlight || "#fffaf0");
    headGradient.addColorStop(1, style.headColor);
    ctx.fillStyle = headGradient;
    ctx.beginPath();
    ctx.arc(head.x, head.y, headR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = style.eyeColor || "#0a1017";
    ctx.beginPath();
    ctx.ellipse(head.x - headR * 0.34, head.y - headR * 0.08, headR * 0.09, headR * 0.14, 0, 0, Math.PI * 2);
    ctx.ellipse(head.x + headR * 0.34, head.y - headR * 0.08, headR * 0.09, headR * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();

    if (style.type === "enemy") {
      ctx.fillStyle = "rgba(255, 60, 120, 0.95)";
      ctx.beginPath();
      ctx.ellipse(head.x - headR * 0.34, head.y - headR * 0.08, headR * 0.16, headR * 0.1, 0, 0, Math.PI * 2);
      ctx.ellipse(head.x + headR * 0.34, head.y - headR * 0.08, headR * 0.16, headR * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "#f15b96";
      ctx.lineWidth = Math.max(2, scale * 0.08);
      ctx.beginPath();
      ctx.moveTo(head.x - headR * 0.32, head.y - headR * 0.7);
      ctx.lineTo(head.x - headR * 1.15, head.y - headR * 2.1);
      ctx.lineTo(head.x - headR * 0.82, head.y - headR * 3.15);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(head.x + headR * 0.32, head.y - headR * 0.7);
      ctx.lineTo(head.x + headR * 1.15, head.y - headR * 2.1);
      ctx.lineTo(head.x + headR * 0.82, head.y - headR * 3.15);
      ctx.stroke();

      ctx.strokeStyle = "rgba(255, 110, 160, 0.85)";
      ctx.lineWidth = Math.max(1.5, scale * 0.05);
      ctx.beginPath();
      ctx.moveTo(head.x - headR * 0.08, head.y + headR * 0.18);
      ctx.lineTo(head.x - headR * 0.22, head.y + headR * 0.48);
      ctx.lineTo(head.x, head.y + headR * 0.42);
      ctx.lineTo(head.x + headR * 0.22, head.y + headR * 0.48);
      ctx.lineTo(head.x + headR * 0.08, head.y + headR * 0.18);
      ctx.stroke();

      for (let i = 0; i < 4; i += 1) {
        const a = performance.now() * 0.0015 + (i / 4) * Math.PI * 2;
        const mx = torso.x + Math.cos(a) * bodyW * 1.35;
        const my = torso.y + bodyH * 0.18 + Math.sin(a * 1.2) * bodyH * 0.18;
        ctx.fillStyle = ["#ff00cc", "#00d9ff", "#6dff00", "#fff000"][i];
        ctx.fillRect(mx - scale * 0.18, my - scale * 0.18, scale * 0.36, scale * 0.36);
      }
    }

    if (style.type === "player") {
      const gunX = torso.x + bodyW * 0.92;
      const gunY = torso.y + bodyH * 0.32;
      ctx.strokeStyle = "#d7e7f4";
      ctx.lineWidth = Math.max(5, scale * 0.12);
      ctx.beginPath();
      ctx.moveTo(gunX - scale * 0.35, gunY);
      ctx.lineTo(gunX + scale * 0.8, gunY - scale * 0.08);
      ctx.stroke();
      ctx.strokeStyle = "#6f7f90";
      ctx.lineWidth = Math.max(2, scale * 0.06);
      ctx.beginPath();
      ctx.moveTo(gunX - scale * 0.02, gunY + scale * 0.1);
      ctx.lineTo(gunX + scale * 0.55, gunY + scale * 0.06);
      ctx.stroke();

      if (player.shotFlash > 0) {
        ctx.fillStyle = `rgba(255, 240, 160, ${player.shotFlash * 8})`;
        ctx.beginPath();
        ctx.arc(gunX + scale * 0.82, gunY - scale * 0.1, scale * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      const swing = enemy.swingTime > 0 ? (1 - enemy.swingTime / 0.35) * 1.5 : 0.2;
      const hx = torso.x + bodyW * 0.92;
      const hy = torso.y + bodyH * 0.25;
      ctx.strokeStyle = "#ff4d8c";
      ctx.lineWidth = Math.max(4, scale * 0.1);
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx + Math.cos(0.7 + swing) * scale * 1.8, hy + Math.sin(0.7 + swing) * scale * 1.8);
      ctx.stroke();
      ctx.strokeStyle = "#6ef3ff";
      ctx.lineWidth = Math.max(3, scale * 0.08);
      ctx.beginPath();
      ctx.arc(
        hx + Math.cos(0.7 + swing) * scale * 1.8,
        hy + Math.sin(0.7 + swing) * scale * 1.8,
        scale * 0.6,
        -0.8,
        1.8
      );
      ctx.stroke();

      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = Math.max(1.5, scale * 0.04);
      ctx.beginPath();
      ctx.moveTo(torso.x - bodyW * 0.48, torso.y + bodyH * 0.08);
      ctx.lineTo(torso.x - bodyW * 0.18, torso.y + bodyH * 0.52);
      ctx.moveTo(torso.x + bodyW * 0.48, torso.y + bodyH * 0.08);
      ctx.lineTo(torso.x + bodyW * 0.18, torso.y + bodyH * 0.52);
      ctx.stroke();

      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.beginPath();
      ctx.moveTo(torso.x - bodyW * 0.7, shoulderY - bodyW * 0.08);
      ctx.lineTo(torso.x - bodyW * 1.18, shoulderY + bodyH * 0.42);
      ctx.lineTo(torso.x - bodyW * 0.54, shoulderY + bodyH * 0.26);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(torso.x + bodyW * 0.7, shoulderY - bodyW * 0.08);
      ctx.lineTo(torso.x + bodyW * 1.18, shoulderY + bodyH * 0.42);
      ctx.lineTo(torso.x + bodyW * 0.54, shoulderY + bodyH * 0.26);
      ctx.closePath();
      ctx.fill();
    }

    if (style.type === "player") {
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = Math.max(1.5, scale * 0.04);
      ctx.beginPath();
      ctx.moveTo(head.x, head.y + headR * 0.18);
      ctx.lineTo(head.x, head.y + headR * 0.45);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(head.x, head.y + headR * 0.32, headR * 0.22, 0.15, Math.PI - 0.15);
      ctx.stroke();
    } else {
      ctx.strokeStyle = "#ff6b9d";
      ctx.lineWidth = Math.max(1.8, scale * 0.05);
      ctx.beginPath();
      ctx.arc(head.x, head.y + headR * 0.28, headR * 0.26, 0.12, Math.PI - 0.12);
      ctx.stroke();
    }

    if (hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.35, style.hit)})`;
      ctx.fillRect(torso.x - bodyW, head.y - headR * 2, bodyW * 2, bodyH * 3);
    }

    ctx.restore();
  }

  function drawProjectiles(cam) {
    for (const shot of projectiles) {
      const p = projectPoint(shot.x, shot.y ?? 1.95, shot.z, cam);
      if (!p) continue;
      const isMissile = shot.type === "missile";
      const r = Math.max(isMissile ? 5 : 3, (isMissile ? 120 : 90) / p.depth);
      const isEnemyShot = shot.owner === "enemy";
      ctx.fillStyle = isEnemyShot ? "#ff6aa2" : isMissile ? "#ffd86e" : "#fff2a6";
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isEnemyShot ? "#ffd7e6" : isMissile ? "#fff9c4" : "#6ef3ff";
      ctx.lineWidth = Math.max(1, r * 0.35);
      ctx.stroke();

      if (isMissile) {
        ctx.strokeStyle = "rgba(110, 243, 255, 0.85)";
        ctx.lineWidth = Math.max(1.4, r * 0.22);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y + r * 0.2);
        ctx.lineTo(p.x - r * 1.4, p.y + r * 0.8);
        ctx.stroke();
      }
    }
  }

  function drawLightningWarnings(cam) {
    for (const zone of lightningZones) {
      const base = projectPoint(zone.x, 0.02, zone.z, cam);
      const edge = projectPoint(zone.x + zone.radius, 0.02, zone.z, cam);
      if (!base || !edge) continue;

      const radius = Math.abs(edge.x - base.x);
      ctx.save();
      ctx.translate(base.x, base.y);
      ctx.scale(1, 0.42);

      if (!zone.hit) {
        const pulse = 0.45 + Math.sin(performance.now() * 0.02) * 0.18;
        ctx.fillStyle = `rgba(255, 30, 50, ${pulse})`;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 190, 190, 0.9)";
        ctx.lineWidth = Math.max(2, radius * 0.06);
        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.92, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const strikeAlpha = Math.max(0, zone.flash * 5);
        ctx.fillStyle = `rgba(255,255,255,${strikeAlpha * 0.5})`;
        ctx.beginPath();
        ctx.arc(0, 0, radius * 1.05, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  function drawLightningBolts(cam) {
    for (const zone of lightningZones) {
      if (!zone.hit) continue;

      const ground = projectPoint(zone.x, 0.1, zone.z, cam);
      const top = projectPoint(zone.x, 8.5, zone.z, cam);
      if (!ground || !top) continue;

      const alpha = Math.max(0, zone.flash * 5.5);
      ctx.save();
      ctx.strokeStyle = `rgba(255, 60, 210, ${alpha})`;
      ctx.lineWidth = Math.max(3, 16 / ground.depth);
      ctx.shadowBlur = 24;
      ctx.shadowColor = "rgba(90, 245, 255, 0.95)";
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(ground.x - 10, ground.y - 40);
      ctx.lineTo(ground.x + 8, ground.y - 18);
      ctx.lineTo(ground.x - 4, ground.y);
      ctx.stroke();

      ctx.strokeStyle = `rgba(170, 255, 255, ${alpha})`;
      ctx.lineWidth = Math.max(1.5, 8 / ground.depth);
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(ground.x - 6, ground.y - 32);
      ctx.lineTo(ground.x + 5, ground.y - 12);
      ctx.lineTo(ground.x, ground.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawEnemyOrbs(cam) {
    const orbs = getEnemyOrbPositions();
    for (const orb of orbs) {
      const p = projectPoint(orb.x, orb.y, orb.z, cam);
      if (!p) continue;
      const r = Math.max(6, 115 / p.depth);
      const glow = ctx.createRadialGradient(p.x, p.y, r * 0.25, p.x, p.y, r * 1.6);
      glow.addColorStop(0, "rgba(255, 235, 245, 0.95)");
      glow.addColorStop(0.45, "rgba(255, 110, 162, 0.8)");
      glow.addColorStop(1, "rgba(255, 110, 162, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 1.7, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#ff6aa2";
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff5fb";
      ctx.lineWidth = Math.max(1.5, r * 0.22);
      ctx.stroke();
    }
  }

  function drawTransformationAura(cam) {
    if (enemy.transformTime <= 0) {
      return;
    }

    const center = projectPoint(enemy.x, 2.1, enemy.z, cam);
    if (!center) {
      return;
    }

    const progress = 1 - enemy.transformTime / 1.8;
    const ringRadius = (70 + progress * 180) / Math.max(0.8, center.depth * 0.1);
    const alpha = Math.max(0.18, 0.7 - progress * 0.35);

    ctx.save();
    ctx.globalCompositeOperation = "screen";

    for (let i = 0; i < 3; i += 1) {
      const growth = ringRadius * (0.65 + i * 0.28);
      ctx.strokeStyle = `rgba(255,255,255,${alpha - i * 0.14})`;
      ctx.lineWidth = Math.max(2, 7 - i * 1.5);
      ctx.beginPath();
      ctx.arc(center.x, center.y, growth, 0, Math.PI * 2);
      ctx.stroke();
    }

    const glow = ctx.createRadialGradient(center.x, center.y, 10, center.x, center.y, ringRadius * 1.4);
    glow.addColorStop(0, "rgba(255,255,255,0.95)");
    glow.addColorStop(0.25, "rgba(255,212,237,0.7)");
    glow.addColorStop(1, "rgba(255,212,237,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(center.x, center.y, ringRadius * 1.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawWorld() {
    const cam = getCamera();
    drawBackground();
    drawPillarWorld(cam);
    drawArena(cam);

    const objects = [
      { depth: distance({ x: cam.x, z: cam.z }, player), draw: () => drawCharacter(player, cam, {
        type: "player",
        legColor: "#223344",
        bodyColor: "#d8e3ef",
        armColor: "#f0d2bf",
        headColor: "#e0b59a",
        headHighlight: "#f2d6c4",
        eyeColor: "#2e211d",
        bootColor: "#111822",
        hit: player.hurtTime > 0 ? 0.25 : 0
      }) },
    ];

    if (enemy.alive) {
      objects.push({ depth: distance({ x: cam.x, z: cam.z }, enemy), draw: () => drawCharacter(enemy, cam, {
        type: "enemy",
        legColor: "#a8abb4",
        bodyColor: "#18070f",
        armColor: "#2a0a15",
        headColor: "#6f5b58",
        headHighlight: "#b59a94",
        eyeColor: "#ff4b82",
        bootColor: "#d7d9df",
        hit: enemy.swingTime > 0 ? 0.08 : 0
      }) });
    }

    objects.sort((a, b) => b.depth - a.depth);
    drawLightningWarnings(cam);
    objects.forEach((obj) => obj.draw());
    drawTransformationAura(cam);
    drawEnemyOrbs(cam);
    drawProjectiles(cam);
    drawLightningBolts(cam);

    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(canvas.width * 0.5 - 1, canvas.height * 0.5 - 10, 2, 20);
    ctx.fillRect(canvas.width * 0.5 - 10, canvas.height * 0.5 - 1, 20, 2);
  }

  function tick(now) {
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;
    if (pendingTransitionMode) {
      roundTransitionTime = Math.max(0, roundTransitionTime - dt);
      if (roundTransitionTime <= 0) {
        const transitionMode = pendingTransitionMode;
        pendingTransitionMode = null;
        if (transitionMode === "endless" && currentMode === "endless" && !gameOver) {
          startNextEndlessRound();
        }
        if (transitionMode === "story" && currentMode === "story" && !gameOver) {
          resetGame("story");
        }
      }
    }
    updatePlayer(dt);
    updateEnemy(dt);
    updateLightning(dt);
    updateProjectiles(dt);
    updateDebugUi();
    drawWorld();
    requestAnimationFrame(tick);
  }

  window.addEventListener("keydown", (event) => {
    keys[event.code] = true;
    if (event.code === "KeyF") {
      attack();
    }
    if (event.code === "KeyZ" && adminMode) {
      toggleAdminOneShot();
    }
    if (event.code === "KeyU" && adminMode) {
      toggleAdminInfiniteHealth();
    }
    if (event.code === "KeyT" && adminMode) {
      spawnAdminBoss();
    }
    if (event.code === "KeyR" && gameOver) {
      resetGame();
    }
  });

  window.addEventListener("keyup", (event) => {
    keys[event.code] = false;
  });

  canvas.addEventListener("click", () => {
    if (!gameStarted || document.pointerLockElement === canvas) {
      return;
    }
    canvas.requestPointerLock();
  });

  canvas.addEventListener("mousedown", (event) => {
    if (!gameStarted) {
      return;
    }
    if (document.pointerLockElement !== canvas) {
      canvas.requestPointerLock();
      return;
    }
    if (event.button === 0) {
      attack();
      return;
    }
    if (event.button === 2) {
      fireSpecialVolley();
    }
  });

  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  document.addEventListener("pointerlockchange", () => {
    camera.pointerLocked = document.pointerLockElement === canvas;
    camera.pendingLookX = 0;
    camera.pendingLookY = 0;
    if (gameStarted && !camera.pointerLocked && !gameOver) {
      setMessage("Klicke ins Spielfeld, um die Maussteuerung wieder zu aktivieren.");
    }
  });

  window.addEventListener("mousemove", (event) => {
    if (!camera.pointerLocked || !gameStarted || gameOver) {
      return;
    }
    camera.pendingLookX += event.movementX;
    camera.pendingLookY += event.movementY;
  });

  window.addEventListener("resize", resize);

  startStoryButton.addEventListener("click", () => {
    resetGame("story");
    canvas.requestPointerLock();
  });
  startEndlessButton.addEventListener("click", () => {
    resetGame("endless");
    canvas.requestPointerLock();
  });
  toggleAdminButton.addEventListener("click", toggleAdminMode);

  resize();
  loadHighscore();
  updateMetaUi();
  updateBars();
  setMessage("Waehle im Startmenue einen Modus aus.");
  requestAnimationFrame(tick);
})();
