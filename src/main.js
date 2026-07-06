import * as THREE from 'three';
import { generateDungeon } from './core/generator.js';
import { DungeonRenderer } from './render/renderer.js';
import { buildDungeonScene } from './render/sceneBuilder.js';
import { CombatSystem } from './core/combat.js';
import { CardManager } from './core/cards.js';

let renderer, combatSystem, cardManager;
let currentDungeon = null;
let activeDungeonGroup = null;

// Ссылки на 3D модели персонажа и монстров
let playerMesh = null;
const monsterMeshesMap = new Map();

// Состояние анимации сборки уровня
const buildTimeline = {
    active: false,
    elapsed: 0.0,
    duration: 6.0,
    bfsThreshold: 0,
    wallGrowth: 0.0,
    propsScale: 0.0
};

// Хранилище отладочных фильтров
const activeToggles = {
    delaunay: false,
    mst: false,
    loopEdges: false,
    critPath: false,
    heatmap: false
};

/**
 * Стартовая инициализация игры при загрузке DOM.
 */
function initGame() {
    const container = document.getElementById('canvas-container');
    renderer = new DungeonRenderer(container);
    renderer.init();

    setupUIListeners();
    constructNewDungeon();

    // Запуск цикла анимации
    const clock = new THREE.Clock();
    function animate() {
        requestAnimationFrame(animate);
        const dt = clock.getDelta();
        const time = clock.getElapsedTime();

        // 1. Анимация плавного наезда / возврата камеры
        renderer.update(dt);

        // 2. Обработка временной шкалы сборки уровня
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
                buildTimeline.active = false; // Сборка завершена
            }

            reconstruct3DScene();
        }

        // 3. Эффект покачивания и мерцания пламени факелов
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
 * Генерация и запуск новой игровой сессии.
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

    // 1. Процедурная генерация графа и комнат
    const t0 = performance.now();
    currentDungeon = generateDungeon(params);
    const duration = performance.now() - t0;

    // 2. Инициализация боевой пошаговой системы
    combatSystem = new CombatSystem(currentDungeon, seed);
    combatSystem.spawnEntities();
    cardManager = new CardManager(combatSystem.player);

    // Добавим игроку парочку случайных стартовых карт
    cardManager.addCard('Удар');
    cardManager.addCard('Блок');

    // 3. Подгонка камеры под масштаб сгенерированного подземелья
    renderer.fitCamera(currentDungeon);

    // Сброс шкалы анимации
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

    // Вывод логов и статистики на экран
    updateUIStats(duration);
    reconstruct3DScene();
    updateCardUI();
}

/**
 * Пересборка 3D-сцены подземелья с учетом тумана войны и анимаций.
 */
function reconstruct3DScene() {
    if (activeDungeonGroup) {
        renderer.scene.remove(activeDungeonGroup);
        if (activeDungeonGroup.userData.dispose) activeDungeonGroup.userData.dispose();
    }

    // Очищаем старые модели персонажей на сцене
    if (playerMesh) renderer.scene.remove(playerMesh);
    for (let mesh of monsterMeshesMap.values()) {
        renderer.scene.remove(mesh);
    }
    monsterMeshesMap.clear();

    const theme = document.getElementById('param-theme').value;

    // Собираем объект состояния взгляда персонажа для конусного тумана войны
    const playerState = {
        x: combatSystem.player.x,
        y: combatSystem.player.y,
        dir: combatSystem.player.dir
    };

    // Строим сцену
    activeDungeonGroup = buildDungeonScene(currentDungeon, theme, activeToggles, buildTimeline, playerState);
    renderer.scene.add(activeDungeonGroup);

    // Добавляем 3D маркер игрока на карту
    createPlayer3DModel();
    // Добавляем 3D маркеры живых монстров на карту
    createMonsters3DModels();
}

/**
 * Создание лоу-поли 3D фигурки игрока (Светящаяся синяя сфера-указатель направления).
 */
function createPlayer3DModel() {
    const playerGroup = new THREE.Group();
    
    // Сфера тела
    const geomBody = new THREE.SphereGeometry(0.35, 8, 8);
    const matBody = new THREE.MeshPhongMaterial({ color: 0x3b82f6, shininess: 30, flatShading: true });
    const body = new THREE.Mesh(geomBody, matBody);
    body.position.y = 0.4;
    playerGroup.add(body);

    // Указатель направления конуса взгляда (нос)
    const geomPointer = new THREE.ConeGeometry(0.12, 0.35, 4);
    geomPointer.rotateX(Math.PI * 0.5); // Разворачиваем вдоль горизонтали
    const pointer = new THREE.Mesh(geomPointer, matBody);
    pointer.position.set(0, 0.4, 0.4);
    playerGroup.add(pointer);

    // Позиционируем на игровую клетку
    playerGroup.position.set(combatSystem.player.x, 0, combatSystem.player.y);
    playerGroup.rotation.y = combatSystem.player.dir; // Разворот согласно dir взгляда

    playerMesh = playerGroup;
    renderer.scene.add(playerMesh);
}

/**
 * Создание 3D-моделей монстров на карте (цветные цилиндры в зависимости от ранга).
 */
function createMonsters3DModels() {
    const geom = new THREE.CylinderGeometry(0.2, 0.25, 0.8, 6);
    geom.translate(0, 0.4, 0);

    for (let m of combatSystem.monsters) {
        if (m.hp <= 0) continue;

        let color = 0x22c55e; // Обычный - Зеленый
        let heightMultiplier = 1.0;

        if (m.tier === 'boss') {
            color = 0xef4444; // Босс - Красный
            heightMultiplier = 1.6;
        } else if (m.tier === 'elite') {
            color = 0xf59e0b; // Элита - Оранжевый
            heightMultiplier = 1.3;
        } else if (m.tier === 'champion') {
            color = 0xa855f7; // Чемпион - Фиолетовый
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
 * Обработка шагов по клавиатуре (W, A, S, D и Стрелки).
 */
window.addEventListener('keydown', (e) => {
    if (!combatSystem || buildTimeline.active) return;

    let dx = 0, dy = 0;
    const key = e.key.toLowerCase();

    if (key === 'w' || key === 'arrowup') dy = -1;
    else if (key === 's' || key === 'arrowdown') dy = 1;
    else if (key === 'a' || key === 'arrowleft') dx = -1;
    else if (key === 'd' || key === 'arrowright') dx = 1;

    if (dx !== 0 || dy !== 0) {
        // Проводим пошаговый такт
        const stepResult = combatSystem.processStep(dx, dy);

        if (stepResult.combatTriggered) {
            // ЭФФЕКТ: Плавный кинематографичный наезд камеры на место сражения
            const combatRoom = currentDungeon.rooms.find(r => r.id === stepResult.combatReport.attackerTier.roomId || r.id === stepResult.combatReport.defenderTier.roomId) 
                || { cx: combatSystem.player.x, cy: combatSystem.player.y };
            
            const combatLocation = new THREE.Vector3(combatRoom.cx, 0, combatRoom.cy);
            renderer.triggerCameraTransition(combatLocation, 8.5, 0.8); // Наезд за 0.8 сек!

            // Выводим результаты дуэли
            setTimeout(() => {
                alert(stepResult.combatReport.logs.join('\n'));
                
                // Возвращаем камеру обратно на слежение за игроком
                const playerLocation = new THREE.Vector3(combatSystem.player.x, 0, combatSystem.player.y);
                renderer.triggerCameraTransition(playerLocation, camera.userData.frustumSize, 0.8);
                
                reconstruct3DScene();
                updateCardUI();
            }, 900);
        } else {
            // Обычный мирный шаг: плавно двигаем камеру за игроком без зума
            const playerLocation = new THREE.Vector3(combatSystem.player.x, 0, combatSystem.player.y);
            renderer.triggerCameraTransition(playerLocation, renderer.camera.userData.frustumSize, 0.35);
        }

        reconstruct3DScene();
    }
});

/**
 * Обновление интерфейса карт игрока на HTML-панели.
 */
function updateCardUI() {
    // В будущем здесь можно рендерить полноценные скроллируемые 3D-карты.
    // Сейчас выведем их простым списком в логи панели для отладки.
    console.log("Текущие карты в руке игрока:", combatSystem.player.cards);
}

/**
 * Связывание кнопок интерфейса.
 */
function setupUIListeners() {
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
}

function updateUIStats(latency) {
    document.getElementById('stat-latency').textContent = `${latency.toFixed(1)} ms`;
}

// Запуск инициализации при загрузке документа
window.addEventListener('DOMContentLoaded', initGame);
