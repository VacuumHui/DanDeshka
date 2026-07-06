import * as THREE from 'three';
import { generateDungeon } from './core/generator.js';
import { DungeonRenderer } from './render/renderer.js';
import { buildDungeonScene } from './render/sceneBuilder.js';
import { CombatSystem } from './core/combat.js';
import { CardManager, CARD_DATABASE } from './core/cards.js';

let renderer, combatSystem, cardManager;
let currentDungeon = null;
let activeDungeonGroup = null;

let playerMesh = null;
const monsterMeshesMap = new Map();

// Текущий активный бой
let activeCombatReport = null;
let selectedBurnCardIndex = -1;

const buildTimeline = {
    active: false,
    elapsed: 0.0,
    duration: 6.0,
    bfsThreshold: 0,
    wallGrowth: 0.0,
    propsScale: 0.0
};

const activeToggles = {
    delaunay: false,
    mst: false,
    loopEdges: false,
    critPath: false,
    heatmap: false
};

/**
 * Инициализация игры
 */
function initGame() {
    const container = document.getElementById('canvas-container');
    renderer = new DungeonRenderer(container);
    renderer.init();

    setupUIListeners();
    constructNewDungeon();

    const clock = new THREE.Clock();
    function animate() {
        requestAnimationFrame(animate);
        const dt = clock.getDelta();
        const time = clock.getElapsedTime();

        renderer.update(dt);

        if (buildTimeline.active && currentDungeon) {
            buildTimeline.elapsed += dt;
            const progress = Math.min(buildTimeline.elapsed / buildTimeline.duration, 1.0);

            if (progress < 0.4) {
                const normFloor = progress / 0.4;
                buildTimeline.bfsThreshold = Math.floor(normFloor * currentDungeon.stats.maxBfs);
                buildTimeline.wallGrowth = 0.0;
                buildTimeline.propsScale = 0.0;
            } else if (progress < 0.7) {
                buildTimeline.bfsThreshold = currentDungeon.stats.maxBfs;
                buildTimeline.wallGrowth = (progress - 0.4) / 0.3;
                buildTimeline.propsScale = 0.0;
            } else {
                buildTimeline.bfsThreshold = currentDungeon.stats.maxBfs;
                buildTimeline.wallGrowth = 1.0;
                buildTimeline.propsScale = Math.min(1.0, (progress - 0.7) / 0.3);
            }

            if (progress >= 1.0) {
                buildTimeline.active = false;
            }

            reconstruct3DScene();
        }

        if (activeDungeonGroup && activeDungeonGroup.userData.lights) {
            const lights = activeDungeonGroup.userData.lights;
            for (let i = 0; i < lights.length; i++) {
                const lObj = lights[i];
                const noise = 0.88 + 0.12 * Math.sin(time * 12.0 + i * 4.5) * Math.cos(time * 8.2 - i * 2.3);
                lObj.ref.intensity = lObj.baseIntensity * noise;
            }
        }
    }
    animate();
}

/**
 * Создание нового подземелья
 */
function constructNewDungeon() {
    const seedRaw = document.getElementById('seed-input').value;
    const seed = parseFloat(seedRaw) || 12345;
    document.getElementById('seed-val').textContent = seed;

    const roomCount = parseInt(document.getElementById('param-rooms').value);
    const loopChance = parseFloat(document.getElementById('param-loops').value);
    const decorDensity = parseFloat(document.getElementById('param-decor').value);
    const theme = document.getElementById('param-theme').value;
    const animEnabled = document.getElementById('toggle-animate').checked;

    const params = { seed, roomCount, loopChance, decorDensity, theme };

    const t0 = performance.now();
    currentDungeon = generateDungeon(params);
    const duration = performance.now() - t0;

    combatSystem = new CombatSystem(currentDungeon, seed);
    combatSystem.spawnEntities();
    cardManager = new CardManager(combatSystem.player);

    cardManager.addCard('Удар');
    cardManager.addCard('Блок');
    cardManager.addCard('Свиток искр');

    // ФИКС ОШИБКИ: Подгонка ортографической камеры рендерера через renderer.camera [INDEX]
    const aspect = window.innerWidth / window.innerHeight;
    const mapSize = Math.max(currentDungeon.W, currentDungeon.H);
    let frustumSize = mapSize * 0.65;
    
    if (aspect < 1.0) {
        frustumSize = frustumSize / aspect;
    }
    renderer.camera.userData.frustumSize = frustumSize;

    renderer.camera.left = -frustumSize * aspect;
    renderer.camera.right = frustumSize * aspect;
    renderer.camera.top = frustumSize;
    renderer.camera.bottom = -frustumSize;
    renderer.camera.updateProjectionMatrix();

    const offset = mapSize * 0.8;
    renderer.camera.position.set(
        currentDungeon.W * 0.5 + offset,
        offset * Math.tan(35.264 * Math.PI / 180),
        currentDungeon.H * 0.5 + offset
    );

    renderer.controls.target.set(currentDungeon.W * 0.5, 0, currentDungeon.H * 0.5);
    renderer.controls.update();

    if (renderer.scene.fog) {
        const mapRadius = Math.hypot(currentDungeon.W, currentDungeon.H) * 0.5;
        renderer.scene.fog.near = mapRadius * 0.4;
        renderer.scene.fog.far = mapRadius * 3.5;
    }

    if (animEnabled) {
        buildTimeline.active = true;
        buildTimeline.elapsed = 0.0;
        buildTimeline.bfsThreshold = 0;
        buildTimeline.wallGrowth = 0.0;
        buildTimeline.propsScale = 0.0;
    } else {
        buildTimeline.active = false;
        buildTimeline.bfsThreshold = currentDungeon.stats.maxBfs;
        buildTimeline.wallGrowth = 1.0;
        buildTimeline.propsScale = 1.0;
    }

    updateUIStats(duration);
    reconstruct3DScene();
    updateHUD();
    updateCardsPanel();
}

/**
 * Пересборка сцены
 */
function reconstruct3DScene() {
    if (activeDungeonGroup) {
        renderer.scene.remove(activeDungeonGroup);
        if (activeDungeonGroup.userData.dispose) activeDungeonGroup.userData.dispose();
    }

    if (playerMesh) renderer.scene.remove(playerMesh);
    for (let mesh of monsterMeshesMap.values()) {
        renderer.scene.remove(mesh);
    }
    monsterMeshesMap.clear();

    const theme = document.getElementById('param-theme').value;
    const playerState = {
        x: combatSystem.player.x,
        y: combatSystem.player.y,
        dir: combatSystem.player.dir
    };

    activeDungeonGroup = buildDungeonScene(currentDungeon, theme, activeToggles, buildTimeline, playerState);
    renderer.scene.add(activeDungeonGroup);

    createPlayer3DModel();
    createMonsters3DModels();
}

function createPlayer3DModel() {
    const playerGroup = new THREE.Group();
    const geomBody = new THREE.SphereGeometry(0.35, 8, 8);
    const matBody = new THREE.MeshPhongMaterial({ color: 0x3b82f6, shininess: 30, flatShading: true });
    const body = new THREE.Mesh(geomBody, matBody);
    body.position.y = 0.4;
    playerGroup.add(body);

    const geomPointer = new THREE.ConeGeometry(0.12, 0.35, 4);
    geomPointer.rotateX(Math.PI * 0.5);
    const pointer = new THREE.Mesh(geomPointer, matBody);
    pointer.position.set(0, 0.4, 0.4);
    playerGroup.add(pointer);

    playerGroup.position.set(combatSystem.player.x, 0, combatSystem.player.y);
    playerGroup.rotation.y = combatSystem.player.dir;

    playerMesh = playerGroup;
    renderer.scene.add(playerMesh);
}

function createMonsters3DModels() {
    const geom = new THREE.CylinderGeometry(0.2, 0.25, 0.8, 6);
    geom.translate(0, 0.4, 0);

    for (let m of combatSystem.monsters) {
        if (m.hp <= 0) continue;

        let color = 0x22c55e;
        let heightMultiplier = 1.0;

        if (m.tier === 'boss') {
            color = 0xef4444;
            heightMultiplier = 1.6;
        } else if (m.tier === 'elite') {
            color = 0xf59e0b;
            heightMultiplier = 1.3;
        } else if (m.tier === 'champion') {
            color = 0xa855f7;
            heightMultiplier = 1.15;
        }

        const mat = new THREE.MeshPhongMaterial({ color, flatShading: true, shininess: 10 });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.scale.set(1, heightMultiplier, 1);
        mesh.position.set(m.x, 0, m.y);

        renderer.scene.add(mesh);
        monsterMeshesMap.set(m.id, mesh);
    }
}

/**
 * Выполнение физического пошагового движения
 */
function handlePlayerMove(dx, dy) {
    if (activeCombatReport || buildTimeline.active) return;

    const stepResult = combatSystem.processStep(dx, dy);

    if (stepResult.combatTriggered) {
        // Запуск фазы боя
        openCombatModal(stepResult.combatReport);
    } else {
        // Обычное мирное перемещение и следование камеры
        const playerLocation = new THREE.Vector3(combatSystem.player.x, 0, combatSystem.player.y);
        renderer.triggerCameraTransition(playerLocation, renderer.camera.userData.frustumSize, 0.35);
    }

    reconstruct3DScene();
    updateHUD();
    updateCardsPanel();
}

/**
 * Обновление HUD
 */
function updateHUD() {
    const p = combatSystem.player;
    const hpPct = (p.hp / p.maxHp) * 100;
    const paPct = (p.pa / p.maxPa) * 100;
    const maPct = (p.ma / p.maxMa) * 100;

    document.getElementById('bar-hp').style.width = `${hpPct}%`;
    document.getElementById('txt-hp').textContent = `${p.hp}/${p.maxHp}`;

    document.getElementById('bar-pa').style.width = `${paPct}%`;
    document.getElementById('txt-pa').textContent = `${p.pa}/${p.maxPa}`;

    document.getElementById('bar-ma').style.width = `${maPct}%`;
    document.getElementById('txt-ma').textContent = `${p.ma}/${p.maxMa}`;

    document.getElementById('txt-gold').textContent = p.gold;
}

/**
 * Рендеринг руки карт игрока (внизу экрана)
 */
function updateCardsPanel() {
    const container = document.getElementById('cards-hand-container');
    container.innerHTML = '';

    combatSystem.player.cards.forEach((cardName, idx) => {
        const cardData = CARD_DATABASE[cardName];
        if (!cardData) return;

        const cardEl = document.createElement('div');
        cardEl.className = 'game-card';
        cardEl.innerHTML = `
            <div class="card-name">${cardData.name}</div>
            <div class="card-desc">${cardData.description}</div>
            <button class="card-btn" data-index="${idx}">Разыграть</button>
        `;

        cardEl.querySelector('.card-btn').addEventListener('click', (e) => {
            const index = parseInt(e.target.dataset.index);
            // Во внебоевой фазе разыгрываем карту на себя (например, Блок или Зелье)
            cardManager.playCard(index, combatSystem, combatSystem.player);
            updateHUD();
            updateCardsPanel();
            reconstruct3DScene();
        });

        container.appendChild(cardEl);
    });
}

/**
 * Открытие боевого модального окна в стиле Armello
 */
function openCombatModal(report) {
    activeCombatReport = report;
    selectedBurnCardIndex = -1;

    // Плавный наезд камеры на место боя (крупный план)
    const combatLocation = new THREE.Vector3(combatSystem.player.x, 0, combatSystem.player.y);
    renderer.triggerCameraTransition(combatLocation, 6.5, 0.7);

    document.getElementById('combat-modal').style.display = 'flex';
    document.getElementById('combat-title').textContent = report.playerInitiated ? "ВЫ НАПАЛИ!" : "ВАС АТАКОВАЛИ!";
    
    // Сброс логов и кнопок
    document.getElementById('combat-logs-container').innerHTML = '';
    document.getElementById('btn-roll-combat').style.display = 'block';
    document.getElementById('btn-close-combat').style.display = 'none';

    updateCombatStats();
    renderBurnCards();
}

function updateCombatStats() {
    if (!activeCombatReport) return;
    const p = combatSystem.player;
    // Находим монстра на нашей или соседней клетке (поскольку бой уже запущен, монстр жив)
    const m = combatSystem.monsters.find(m => Math.hypot(m.x - p.x, m.y - p.y) <= 1.1) || {
        tier: "Враг", hp: 0, maxHp: 10, pa: 0, maxPa: 2, ma: 0, maxMa: 2
    };

    document.getElementById('combat-player-hp').textContent = `HP: ${p.hp}/${p.maxHp}`;
    document.getElementById('combat-player-pa').textContent = `PA: ${p.pa}/${p.maxPa}`;
    document.getElementById('combat-player-ma').textContent = `MA: ${p.ma}/${p.maxMa}`;

    document.getElementById('combat-enemy-name').textContent = m.tier.toUpperCase();
    document.getElementById('combat-enemy-hp').textContent = `HP: ${m.hp}/${m.maxHp}`;
    document.getElementById('combat-enemy-pa').textContent = `PA: ${m.pa}/${m.maxPa}`;
    document.getElementById('combat-enemy-ma').textContent = `MA: ${m.ma}/${m.maxMa}`;
}

/**
 * Рендеринг карт в руке, доступных для сжигания (Burn) в бою
 */
function renderBurnCards() {
    const container = document.getElementById('combat-burn-cards');
    container.innerHTML = '';

    combatSystem.player.cards.forEach((cardName, idx) => {
        const cardData = CARD_DATABASE[cardName];
        const cardEl = document.createElement('div');
        cardEl.className = 'game-card';
        if (selectedBurnCardIndex === idx) {
            cardEl.style.borderColor = 'var(--accent-color)';
            cardEl.style.boxShadow = '0 0 10px var(--accent-color)';
        }
        cardEl.innerHTML = `
            <div class="card-name" style="font-size: 0.65rem;">${cardData.name}</div>
            <div class="card-desc" style="font-size: 0.5rem;">Грань: ${cardData.burnFace === 'swords' ? '⚔️' : cardData.burnFace === 'shields' ? '🛡' : '⚡'}</div>
            <button class="card-btn" style="font-size: 0.5rem; background: var(--accent-color);" data-index="${idx}">Выбрать</button>
        `;

        cardEl.querySelector('.card-btn').addEventListener('click', (e) => {
            const index = parseInt(e.target.dataset.index);
            selectedBurnCardIndex = selectedBurnCardIndex === index ? -1 : index;
            renderBurnCards();
        });

        container.appendChild(cardEl);
    });
}

/**
 * Логика рассчета броска кубиков в бою при клике «БРОСИТЬ КУБИКИ»
 */
document.getElementById('btn-roll-combat').addEventListener('click', () => {
    if (!activeCombatReport) return;

    const p = combatSystem.player;
    const m = combatSystem.monsters.find(m => Math.hypot(m.x - p.x, m.y - p.y) <= 1.1);
    if (!m) return;

    let logBox = document.getElementById('combat-logs-container');
    logBox.innerHTML = '';

    // Если игрок выбрал карту для сжигания
    if (selectedBurnCardIndex !== -1) {
        const burnFace = cardManager.burnCard(selectedBurnCardIndex);
        logBox.innerHTML += `<div>🔥 Игрок сжег карту и гарантировал грань: <b>${burnFace === 'swords' ? '⚔️ Меч' : '🛡 Щит'}</b></div>`;
    }

    // Запускаем симуляцию поединка по Armello + DOS2
    let fightReport = null;
    if (activeCombatReport.playerInitiated) {
        fightReport = combatSystem.resolveDuel(p, m, true);
    } else {
        fightReport = combatSystem.resolveDuel(m, p, false);
    }

    // Отрисовываем пошаговые боевые логи в окне модала
    fightReport.logs.forEach(log => {
        logBox.innerHTML += `<div>${log}</div>`;
    });
    logBox.scrollTop = logBox.scrollHeight;

    // Прячем кнопку броска, открываем кнопку «ВЫХОД»
    document.getElementById('btn-roll-combat').style.display = 'none';
    document.getElementById('btn-close-combat').style.display = 'block';

    // Обновляем статистику боя
    updateCombatStats();
    updateHUD();

    // Если игрок победил — выдаем роглайт добычу!
    if (fightReport.victory && fightReport.lootDropped) {
        const loot = fightReport.lootDropped;
        logBox.innerHTML += `<div style="color: var(--success-color); margin-top: 10px; font-weight: bold;">🎉 ДОБЫЧА: Получено [${loot.name}]!</div>`;
        if (loot.type === 'card') {
            cardManager.addCard(loot.name);
        } else if (loot.type === 'equipment') {
            p.gold += 15; // Дадим немного золота за экипировку в прототипе
        }
    }
});

/**
 * Закрытие модального окна и возврат камеры назад
 */
document.getElementById('btn-close-combat').addEventListener('click', () => {
    document.getElementById('combat-modal').style.display = 'none';
    activeCombatReport = null;

    // Очищаем павших монстров с карты
    combatSystem.cleanDeadMonsters();

    // Возвращаем камеру на слежение за игроком с исходным масштабом
    const playerLocation = new THREE.Vector3(combatSystem.player.x, 0, combatSystem.player.y);
    renderer.triggerCameraTransition(playerLocation, renderer.camera.userData.frustumSize, 0.7);

    reconstruct3DScene();
    updateHUD();
    updateCardsPanel();
});

/**
 * Обработка ввода с клавиатуры
 */
window.addEventListener('keydown', (e) => {
    if (!combatSystem || buildTimeline.active || activeCombatReport) return;

    let dx = 0, dy = 0;
    const key = e.key.toLowerCase();

    if (key === 'w' || key === 'arrowup') dy = -1;
    else if (key === 's' || key === 'arrowdown') dy = 1;
    else if (key === 'a' || key === 'arrowleft') dx = -1;
    else if (key === 'd' || key === 'arrowright') dx = 1;

    if (dx !== 0 || dy !== 0) {
        handlePlayerMove(dx, dy);
    }
});

/**
 * Инициализация кнопок управления D-Pad (для смартфонов) [INDEX]
 */
function setupDpad() {
    const bindDpad = (id, dx, dy) => {
        const btn = document.getElementById(id);
        
        // Touch-события для мобильных дисплеев
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            handlePlayerMove(dx, dy);
        });
        
        // Клик как запасной вариант на ПК
        btn.addEventListener('click', () => {
            handlePlayerMove(dx, dy);
        });
    };

    bindDpad('dpad-up', 0, -1);
    bindDpad('dpad-down', 0, 1);
    bindDpad('dpad-left', -1, 0);
    bindDpad('dpad-right', 1, 0);
}

/**
 * Связывание UI шестеренки
 */
function setupUIListeners() {
    // Раскрытие/скрытие панели генератора
    const btnToggle = document.getElementById('btn-settings-toggle');
    const panel = document.getElementById('ui-container');
    
    btnToggle.addEventListener('click', () => {
        panel.classList.toggle('collapsed');
    });

    document.getElementById('btn-roll').addEventListener('click', () => {
        document.getElementById('seed-input').value = Math.floor(Math.random() * 999999);
        constructNewDungeon();
    });

    document.getElementById('btn-generate').addEventListener('click', constructNewDungeon);
    document.getElementById('param-theme').addEventListener('change', reconstruct3DScene);

    const bindToggle = (id, key) => {
        const el = document.getElementById(id);
        activeToggles[key] = el.checked;
        el.addEventListener('change', () => {
            activeToggles[key] = el.checked;
            reconstruct3DScene();
        });
    };

    bindToggle('toggle-delaunay', 'delaunay');
    bindToggle('toggle-mst', 'mst');
    bindToggle('toggle-loop-edges', 'loopEdges');
    bindToggle('toggle-crit-path', 'critPath');
    bindToggle('toggle-heatmap', 'heatmap');

    setupDpad();
}

function updateUIStats(latency) {
    document.getElementById('stat-latency').textContent = `${latency.toFixed(1)} ms`;
    document.getElementById('stat-grid').textContent = `${currentDungeon.W} x ${currentDungeon.H}`;
    document.getElementById('stat-tiles').textContent = `${currentDungeon.stats.floorTiles} / ${currentDungeon.stats.wallTiles}`;
    document.getElementById('stat-rooms').textContent = currentDungeon.stats.rooms;
    document.getElementById('stat-loops').textContent = currentDungeon.stats.loops;
    document.getElementById('stat-crit').textContent = currentDungeon.stats.criticalLength;
    document.getElementById('stat-props').textContent = `${currentDungeon.stats.props} / ${currentDungeon.stats.spawns}`;
    document.getElementById('stat-retries').textContent = currentDungeon.stats.retries;
}

window.addEventListener('DOMContentLoaded', initGame);
