import * as THREE from 'three';

const VOID = 0;
const FLOOR = 1;
const WALL = 2;

/**
 * Алгоритм Брезенхема для проверки прямой видимости между двумя точками на сетке.
 */
function checkLineOfSight(grid, W, x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0);
    let dy = Math.abs(y1 - y0);
    let sx = (x0 < x1) ? 1 : -1;
    let sy = (y0 < y1) ? 1 : -1;
    let err = dx - dy;

    let cx = x0;
    let cy = y0;

    while (true) {
        if (cx === x1 && cy === y1) break;
        
        // Не проверяем саму стартовую клетку, но проверяем все промежуточные
        if (cx !== x0 || cy !== y0) {
            if (grid[cy * W + cx] === WALL) {
                return false; // Видимость заблокирована стеной
            }
        }

        let e2 = 2 * err;
        if (e2 > -dy) {
            err -= dy;
            cx += sx;
        }
        if (e2 < dx) {
            err += dx;
            cy += sy;
        }
    }
    return true;
}

/**
 * Расчет фактора видимости тайла на основе расстояния, угла взгляда игрока и препятствий.
 */
function calculateTileVisibility(grid, W, playerX, playerY, playerDir, tx, ty) {
    const maxRadius = 8.5; // Максимальная дальность обзора
    const nearRadius = 2.5; // Радиус кругового обзора вблизи
    const fovHalfAngle = Math.PI * 0.25; // Угол конуса обзора 90 градусов (по 45 в каждую сторону)

    const dx = tx - playerX;
    const dy = ty - playerY;
    const dist = Math.hypot(dx, dy);

    // Вне радиуса обзора - полная темнота
    if (dist > maxRadius) return 0.0;

    let inSight = false;
    if (dist <= nearRadius) {
        inSight = true; // Круговой обзор вблизи игрока
    } else {
        // Вычисляем угол к тайлу относительно направления движения/взгляда
        const angleToTile = Math.atan2(dy, dx);
        let angleDiff = Math.abs(angleToTile - playerDir);
        
        // Нормализация разности углов до диапазона [0, PI]
        if (angleDiff > Math.PI) {
            angleDiff = Math.PI * 2 - angleDiff;
        }
        
        if (angleDiff <= fovHalfAngle) {
            inSight = true;
        }
    }

    // Если тайл в теории видим - пускаем луч для проверки препятствий стен
    if (inSight) {
        const hasLOS = checkLineOfSight(grid, W, playerX, playerY, tx, ty);
        if (hasLOS) {
            // Мягкое затухание видимости на краю радиуса обзора
            return 1.0 - Math.smoothstep(dist, nearRadius, maxRadius) * 0.75;
        }
    }

    return 0.0; // Скрыто туманом войны
}

/**
 * Строит и собирает 3D-сцену подземелья, оптимизируя геометрию через InstancedMesh.
 */
export function buildDungeonScene(dungeon, themeName, toggles, animState, playerState) {
    const group = new THREE.Group();

    // Настройка цветовых палитр тем
    const palettes = {
        crypt: {
            floor: 0x475569, wall: 0x1e293b, pillar: 0x334155,
            torchLight: 0xff8c3a, torchFlame: 0xff4500,
            tintRange: [0x111827, 0x1e1b4b], groundLight: 0x1e1b4b
        },
        lava: {
            floor: 0x241411, wall: 0x120a08, pillar: 0x1c0f0d,
            torchLight: 0xff4500, torchFlame: 0xffaa00,
            tintRange: [0x3f0a0a, 0x1a0505], groundLight: 0x2d0606
        },
        forest: {
            floor: 0x2d3a22, wall: 0x221a11, pillar: 0x33281b,
            torchLight: 0x22c55e, torchFlame: 0x86efac,
            tintRange: [0x0f1712, 0x142217], groundLight: 0x062d10
        }
    };
    const theme = palettes[themeName] || palettes.crypt;

    // Инициализация низкополигональных базовых геометрий
    const geomFloor = new THREE.BoxGeometry(1, 0.1, 1);
    const geomWall = new THREE.BoxGeometry(1, 1, 1);
    const geomPillar = new THREE.CylinderGeometry(0.18, 0.22, 2.2, 8);
    const geomTorch = new THREE.BoxGeometry(0.08, 0.28, 0.12);
    const geomFlame = new THREE.OctahedronGeometry(0.08, 0);
    const geomDebris = new THREE.DodecahedronGeometry(0.15, 0);
    const geomChest = new THREE.BoxGeometry(0.55, 0.35, 0.35);
    const geomPortal = new THREE.RingGeometry(0.4, 0.6, 16);
    const geomCrystal = new THREE.OctahedronGeometry(0.35, 1);

    // Сдвиги пивотов геометрий для точного позиционирования
    geomFloor.translate(0, -0.05, 0);
    geomWall.translate(0, 0.5, 0);
    geomPillar.translate(0, 1.1, 0);
    geomTorch.translate(0, 0.14, 0);
    geomFlame.translate(0, 0.04, 0);
    geomDebris.translate(0, 0.075, 0);
    geomChest.translate(0, 0.175, 0);
    geomPortal.rotateX(-Math.PI * 0.5); geomPortal.translate(0, 0.02, 0);
    geomCrystal.translate(0, 0.45, 0);

    // Создание материалов (Phong обеспечивает лоу-поли плоское затенение под источниками света)
    const matFloor = new THREE.MeshPhongMaterial({ flatShading: true, shininess: 0 });
    const matWall = new THREE.MeshPhongMaterial({ color: theme.wall, flatShading: true, shininess: 0 });
    const matPillar = new THREE.MeshPhongMaterial({ color: theme.pillar, flatShading: true, shininess: 0 });
    const matTorch = new THREE.MeshPhongMaterial({ color: 0x3e2723, shininess: 0 });
    const matFlame = new THREE.MeshBasicMaterial({ color: theme.torchFlame });
    const matDebris = new THREE.MeshPhongMaterial({ color: 0x4b5563, flatShading: true, shininess: 0 });
    const matChest = new THREE.MeshPhongMaterial({ color: 0x854d0e, flatShading: true, shininess: 5 });
    const matPortal = new THREE.MeshBasicMaterial({ color: 0x3b82f6, side: THREE.DoubleSide });
    const matCrystal = new THREE.MeshBasicMaterial({ color: theme.torchLight });

    // Подсчет количества элементов каждого типа для инстансинга
    let countFloor = 0, countWall = 0;
    for (let i = 0; i < dungeon.W * dungeon.H; i++) {
        if (dungeon.grid[i] === FLOOR) countFloor++;
        if (dungeon.grid[i] === WALL) countWall++;
    }

    const countKind = (k) => dungeon.props.filter(p => p.kind === k).length;

    // Создание InstancedMesh
    const instFloor = new THREE.InstancedMesh(geomFloor, matFloor, countFloor);
    const instWall = new THREE.InstancedMesh(geomWall, matWall, countWall);
    const instPillar = new THREE.InstancedMesh(geomPillar, matPillar, countKind('pillar'));
    const instTorch = new THREE.InstancedMesh(geomTorch, matTorch, countKind('torch'));
    const instFlame = new THREE.InstancedMesh(geomFlame, matFlame, countKind('torch') + countKind('brazier'));
    const instDebris = new THREE.InstancedMesh(geomDebris, matDebris, countKind('debris'));
    const instChest = new THREE.InstancedMesh(geomChest, matChest, countKind('chest') + countKind('brazier'));
    const instPortal = new THREE.InstancedMesh(geomPortal, matPortal, countKind('portal'));
    const instCrystal = new THREE.InstancedMesh(geomCrystal, matCrystal, countKind('crystal'));

    group.add(instFloor, instWall, instPillar, instTorch, instFlame, instDebris, instChest, instPortal, instCrystal);

    // Передаем хук очистки в группу сцены для предотвращения утечек GPU памяти
    group.userData.dispose = () => {
        geomFloor.dispose(); matFloor.dispose();
        geomWall.dispose(); matWall.dispose();
        geomPillar.dispose(); matPillar.dispose();
        geomTorch.dispose(); matTorch.dispose();
        geomFlame.dispose(); matFlame.dispose();
        geomDebris.dispose(); matDebris.dispose();
        geomChest.dispose(); matChest.dispose();
        geomPortal.dispose(); matPortal.dispose();
        geomCrystal.dispose(); matCrystal.dispose();
    };

    const dummy = new THREE.Object3D();
    const colorDummy = new THREE.Color();
    let idxFloor = 0, idxWall = 0, idxPillar = 0, idxTorch = 0, idxFlame = 0, idxDebris = 0, idxChest = 0, idxPortal = 0, idxCrystal = 0;

    const torchFlamePositions = [];

    // 1. Отрисовка полов подземелья (Floor)
    for (let y = 0; y < dungeon.H; y++) {
        for (let x = 0; x < dungeon.W; x++) {
            const idx = y * dungeon.W + x;
            if (dungeon.grid[idx] !== FLOOR) continue;

            let scaleY = 1.0;
            let visibility = 1.0;

            // Если идет анимация сборки сцены, у нее приоритет над туманом войны
            if (animState.active) {
                const distFromFrontier = dungeon.bfs[idx] - animState.bfsThreshold;
                if (distFromFrontier > 0) scaleY = 0.0;
                else if (distFromFrontier > -5) scaleY = 1.0 + (distFromFrontier / 5);
            } else if (playerState) {
                // Иначе рассчитываем конусный туман войны
                visibility = calculateTileVisibility(dungeon.grid, dungeon.W, playerState.x, playerState.y, playerState.dir, x, y);
                scaleY = visibility > 0 ? 1.0 : 0.0; // Опускаем невидимые тайлы под землю
            }

            dummy.position.set(x, 0, y);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set(1, scaleY, 1);
            dummy.updateMatrix();
            instFloor.setMatrixAt(idxFloor, dummy.matrix);

            // Мягкое затемнение по краям (Bake AO на основе количества соседних стен)
            let adjWalls = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx, ny = y + dy;
                    if (nx >= 0 && nx < dungeon.W && ny >= 0 && ny < dungeon.H) {
                        if (dungeon.grid[ny * dungeon.W + nx] === WALL) adjWalls++;
                    }
                }
            }

            const ao = 1.0 - 0.08 * Math.min(adjWalls, 4);
            const hashVal = ((x * 15321 + y * 7412581) % 100) / 100;
            const jitter = 0.95 + hashVal * 0.1;

            if (toggles.heatmap) {
                const heat = dungeon.bfs[idx] / (dungeon.stats.maxBfs || 1);
                colorDummy.setHSL(0.33 * (1.0 - heat), 0.95, 0.45 * ao);
            } else {
                let isRoomTile = false;
                let targetRoom = null;
                for (let r of dungeon.rooms) {
                    const hx = r.w * 0.5, hy = r.h * 0.5;
                    if (x >= r.cx - hx && x < r.cx + hx && y >= r.cy - hy && y < r.cy + hy) {
                        isRoomTile = true;
                        targetRoom = r;
                        break;
                    }
                }

                if (isRoomTile && targetRoom) {
                    const roomHue = ((targetRoom.id * 179) % 360) / 360;
                    const roomColor = new THREE.Color().setHSL(roomHue, 0.45, 0.4);
                    colorDummy.setHex(theme.floor);
                    colorDummy.lerp(roomColor, 0.18).multiplyScalar(ao * jitter * visibility);
                } else {
                    colorDummy.setHex(theme.floor).multiplyScalar(0.7 * ao * jitter * visibility); // Коридоры
                }
            }

            instFloor.setColorAt(idxFloor, colorDummy);
            idxFloor++;
        }
    }

    // 2. Отрисовка внешних стен (Walls)
    const wallRNG = new SeededRNG(dungeon.params.seed + 98765);
    for (let y = 0; y < dungeon.H; y++) {
        for (let x = 0; x < dungeon.W; x++) {
            const idx = y * dungeon.W + x;
            if (dungeon.grid[idx] !== WALL) continue;

            let scaleY = 2.0 + wallRNG.float(-0.25, 0.25);
            let visibility = 1.0;

            if (animState.active) {
                scaleY *= Math.max(0.001, animState.wallGrowth);
            } else if (playerState) {
                // Стены также затухают в тумане войны
                visibility = calculateTileVisibility(dungeon.grid, dungeon.W, playerState.x, playerState.y, playerState.dir, x, y);
                scaleY = visibility > 0 ? scaleY : 0.0;
            }

            dummy.position.set(x, 0, y);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set(1.0, scaleY, 1.0);
            dummy.updateMatrix();
            instWall.setMatrixAt(idxWall, dummy.matrix);

            // Цвет стен подстраивается под туман войны
            colorDummy.setHex(theme.wall).multiplyScalar(visibility);
            instWall.setColorAt(idxWall, colorDummy);
            idxWall++;
        }
    }

    instFloor.count = idxFloor;
    instWall.count = idxWall;

    // 3. Расстановка объектов и окружения (Props)
    const scaleProp = animState.active ? animState.propsScale : 1.0;

    for (let p of dungeon.props) {
        let visibility = 1.0;

        if (!animState.active && playerState) {
            // Объекты также подвержены конусному туману войны
            visibility = calculateTileVisibility(dungeon.grid, dungeon.W, playerState.x, playerState.y, playerState.dir, p.x, p.y);
        }

        const currentScale = p.scale * scaleProp * (visibility > 0 ? 1.0 : 0.0);

        dummy.position.set(p.x, 0, p.y);
        dummy.rotation.set(0, p.rot, 0);
        dummy.scale.set(currentScale, currentScale, currentScale);

        if (p.kind === 'pillar') {
            dummy.updateMatrix();
            instPillar.setMatrixAt(idxPillar, dummy.matrix);
            
            colorDummy.setHex(theme.pillar).multiplyScalar(visibility);
            instPillar.setColorAt(idxPillar, colorDummy);
            idxPillar++;
        } else if (p.kind === 'torch') {
            dummy.position.set(p.x, 1.2, p.y - 0.45);
            dummy.updateMatrix();
            instTorch.setMatrixAt(idxTorch, dummy.matrix);
            idxTorch++;

            dummy.position.set(p.x, 1.4, p.y - 0.4);
            dummy.scale.set(0.8 * currentScale, 0.8 * currentScale, 0.8 * currentScale);
            dummy.updateMatrix();
            instFlame.setMatrixAt(idxFlame, dummy.matrix);
            torchFlamePositions.push(new THREE.Vector3(p.x, 1.4, p.y - 0.4));
            idxFlame++;
        } else if (p.kind === 'brazier') {
            dummy.position.set(p.x, 0.1, p.y);
            dummy.updateMatrix();
            instChest.setMatrixAt(idxChest, dummy.matrix); 
            idxChest++;

            dummy.position.set(p.x, 0.4, p.y);
            dummy.scale.set(1.5 * currentScale, 1.5 * currentScale, 1.5 * currentScale);
            dummy.updateMatrix();
            instFlame.setMatrixAt(idxFlame, dummy.matrix);
            torchFlamePositions.push(new THREE.Vector3(p.x, 0.4, p.y));
            idxFlame++;
        } else if (p.kind === 'debris') {
            dummy.updateMatrix();
            instDebris.setMatrixAt(idxDebris, dummy.matrix);
            idxDebris++;
        } else if (p.kind === 'chest') {
            dummy.updateMatrix();
            instChest.setMatrixAt(idxChest, dummy.matrix);
            idxChest++;
        } else if (p.kind === 'portal') {
            dummy.updateMatrix();
            instPortal.setMatrixAt(idxPortal, dummy.matrix);
            idxPortal++;
        } else if (p.kind === 'crystal') {
            dummy.updateMatrix();
            instCrystal.setMatrixAt(idxCrystal, dummy.matrix);
            idxCrystal++;
        }
    }

    instPillar.count = idxPillar;
    instTorch.count = idxTorch;
    instFlame.count = idxFlame;
    instDebris.count = idxDebris;
    instChest.count = idxChest;
    instPortal.count = idxPortal;
    instCrystal.count = idxCrystal;

    // 4. Отрисовка динамических источников света (Torches / Key Lights)
    const torchBudget = 8;
    const keyLights = [];

    const portal = dungeon.props.find(p => p.kind === 'portal');
    if (portal) keyLights.push({ x: portal.x, y: portal.y, color: 0x3b82f6, intensity: 2.2, height: 0.5 });

    const crystal = dungeon.props.find(p => p.kind === 'crystal');
    if (crystal) keyLights.push({ x: crystal.x, y: crystal.y, color: theme.torchLight, intensity: 2.5, height: 0.8 });

    const bossRoom = dungeon.rooms.find(r => r.type === 'boss');
    if (bossRoom) keyLights.push({ x: bossRoom.cx, y: bossRoom.cy, color: 0xef4444, intensity: 2.8, height: 0.7 });

    const sampleTorches = [];
    const allTorches = dungeon.props.filter(p => p.kind === 'torch');

    if (allTorches.length > 0) {
        sampleTorches.push(allTorches[0]);
        while (sampleTorches.length < Math.min(allTorches.length, torchBudget)) {
            let bestCand = null;
            let maxMinDist = -1;
            for (let t of allTorches) {
                if (sampleTorches.includes(t)) continue;
                let minDist = Infinity;
                for (let s of sampleTorches) {
                    const d = Math.hypot(t.x - s.x, t.y - s.y);
                    minDist = Math.min(minDist, d);
                }
                if (minDist > maxMinDist) {
                    maxMinDist = minDist;
                    bestCand = t;
                }
            }
            if (bestCand) sampleTorches.push(bestCand);
            else break;
        }
    }

    const lightObjects = [];

    for (let kl of keyLights) {
        let currentIntensity = kl.intensity;
        if (!animState.active && playerState) {
            const vis = calculateTileVisibility(dungeon.grid, dungeon.W, playerState.x, playerState.y, playerState.dir, kl.x, kl.y);
            currentIntensity *= vis; // Увеличиваем/гасим свет ключей в зависимости от тумана войны
        }
        const light = new THREE.PointLight(kl.color, currentIntensity, 9.0, 1.8);
        light.position.set(kl.x, kl.height, kl.y);
        group.add(light);
        lightObjects.push({ ref: light, baseIntensity: currentIntensity });
    }

    for (let st of sampleTorches) {
        let currentIntensity = 1.5;
        if (!animState.active && playerState) {
            const vis = calculateTileVisibility(dungeon.grid, dungeon.W, playerState.x, playerState.y, playerState.dir, st.x, st.y);
            currentIntensity *= vis; // Гасим свет настенных факелов, если они во тьме
        }
        const light = new THREE.PointLight(theme.torchLight, currentIntensity, 7.5, 2.0);
        light.position.set(st.x, 1.4, st.y - 0.35);
        group.add(light);
        lightObjects.push({ ref: light, baseIntensity: currentIntensity });
    }

    group.userData.lights = lightObjects;

    // 5. Оверлей отладочной информации (Graph Debug Overlays)
    if (toggles.delaunay && dungeon.delaunayEdges) {
        const matDel = new THREE.LineBasicMaterial({ color: 0x1d4ed8, transparent: true, opacity: 0.45 });
        const pts = [];
        for (let e of dungeon.delaunayEdges) {
            const rA = dungeon.rooms.find(r => r.id === e.a);
            const rB = dungeon.rooms.find(r => r.id === e.b);
            pts.push(new THREE.Vector3(rA.cx, 0.15, rA.cy), new THREE.Vector3(rB.cx, 0.15, rB.cy));
        }
        const geomDel = new THREE.BufferGeometry().setFromPoints(pts);
        group.add(new THREE.LineSegments(geomDel, matDel));
    }

    if (toggles.mst || toggles.loopEdges) {
        const ptsMst = [];
        const ptsLoop = [];
        for (let e of dungeon.edges) {
            const rA = dungeon.rooms.find(r => r.id === e.a);
            const rB = dungeon.rooms.find(r => r.id === e.b);
            if (e.isLoop && toggles.loopEdges) {
                ptsLoop.push(new THREE.Vector3(rA.cx, 0.17, rA.cy), new THREE.Vector3(rB.cx, 0.17, rB.cy));
            } else if (!e.isLoop && toggles.mst) {
                ptsMst.push(new THREE.Vector3(rA.cx, 0.17, rA.cy), new THREE.Vector3(rB.cx, 0.17, rB.cy));
            }
        }

        if (ptsMst.length > 0) {
            const geomM = new THREE.BufferGeometry().setFromPoints(ptsMst);
            const matM = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
            group.add(new THREE.LineSegments(geomM, matM));
        }
        if (ptsLoop.length > 0) {
            const geomL = new THREE.BufferGeometry().setFromPoints(ptsLoop);
            const matL = new THREE.LineBasicMaterial({ color: 0x22d3ee, linewidth: 2 });
            group.add(new THREE.LineSegments(geomL, matL));
        }
    }

    if (toggles.critPath) {
        const ptsCrit = [];
        for (let e of dungeon.edges) {
            if (e.isCritical) {
                const rA = dungeon.rooms.find(r => r.id === e.a);
                const rB = dungeon.rooms.find(r => r.id === e.b);
                ptsCrit.push(new THREE.Vector3(rA.cx, 0.2, rA.cy), new THREE.Vector3(rB.cx, 0.2, rB.cy));
            }
        }
        if (ptsCrit.length > 0) {
            const geomC = new THREE.BufferGeometry().setFromPoints(ptsCrit);
            const matC = new THREE.LineBasicMaterial({ color: 0xef4444, linewidth: 4 });
            group.add(new THREE.LineSegments(geomC, matC));
        }
    }

    // 6. Отрисовка маркеров монстров (Spawns)
    const geomSpawn = new THREE.RingGeometry(0.18, 0.22, 8);
    geomSpawn.rotateX(-Math.PI * 0.5); geomSpawn.translate(0, 0.03, 0);
    const matSpawnMinion = new THREE.MeshBasicMaterial({ color: 0x22c55e, side: THREE.DoubleSide });
    const matSpawnElite = new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide });
    const matSpawnBoss = new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide });

    let countMinions = 0, countElites = 0, countBosses = 0;
    for (let s of dungeon.spawns) {
        if (s.tier === 'minion' || s.tier === 'champion') countMinions++;
        else if (s.tier === 'elite') countElites++;
        else if (s.tier === 'boss') countBosses++;
    }

    const instSpMinion = new THREE.InstancedMesh(geomSpawn, matSpawnMinion, Math.max(1, countMinions));
    const instSpElite = new THREE.InstancedMesh(geomSpawn, matSpawnElite, Math.max(1, countElites));
    const instSpBoss = new THREE.InstancedMesh(geomSpawn, matSpawnBoss, Math.max(1, countBosses));

    let im = 0, ie = 0, ib = 0;
    for (let s of dungeon.spawns) {
        let visibility = 1.0;
        if (!animState.active && playerState) {
            visibility = calculateTileVisibility(dungeon.grid, dungeon.W, playerState.x, playerState.y, playerState.dir, s.x, s.y);
        }

        const currentScale = scaleProp * (visibility > 0 ? 1.0 : 0.0);

        dummy.position.set(s.x, 0, s.y);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(currentScale, currentScale, currentScale);
        dummy.updateMatrix();

        if (s.tier === 'minion' || s.tier === 'champion') {
            instSpMinion.setMatrixAt(im++, dummy.matrix);
        } else if (s.tier === 'elite') {
            instSpElite.setMatrixAt(ie++, dummy.matrix);
        } else if (s.tier === 'boss') {
            instSpBoss.setMatrixAt(ib++, dummy.matrix);
        }
    }

    instSpMinion.count = im;
    instSpElite.count = ie;
    instSpBoss.count = ib;

    group.add(instSpMinion, instSpElite, instSpBoss);

    // Добавляем очистку спавнов при сбросе группы
    const oldDispose = group.userData.dispose;
    group.userData.dispose = () => {
        if (oldDispose) oldDispose();
        geomSpawn.dispose();
        matSpawnMinion.dispose();
        matSpawnElite.dispose();
        matSpawnBoss.dispose();
    };

    return group;
}

/**
 * Класс-декоратор для детерминированного псевдо-генератора шума.
 */
class SeededRNG {
    constructor(seed) {
        this.state = seed >>> 0;
    }
    next() {
        let t = this.state += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    float(a, b) {
        return a + this.next() * (b - a);
    }
    pick(arr) {
        return arr[Math.floor(this.next() * arr.length)];
    }
}
