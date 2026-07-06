import { SeededRNG, getSeedHash } from './rng.js';

// Константы тайлов
const VOID = 0;
const FLOOR = 1;
const WALL = 2;

// Слоги для генерации эпических названий подземелий
const SYLLABLE_ADJ = ["Пепельные", "Багровые", "Тенистые", "Жуткие", "Древние", "Забытые", "Позолоченные", "Обсидиановые", "Разрушенные", "Изумрудные", "Проклятые", "Затонувшие"];
const SYLLABLE_NOUN = ["Чертоги", "Склепы", "Катакомбы", "Залы", "Усыпальницы", "Пещеры", "Руины", "Лабиринты", "Гробницы", "Подземелья", "Святилища", "Бездны"];
const SYLLABLE_NAME = ["Вор'гула", "Зал'кора", "Мальтура", "Ксандора", "Горгорота", "Иггдрасиля", "Ульдуара", "Бримстоуна", "Зул'Гуруба", "Наксрамаса"];

/**
 * Внутренняя функция для создания комнат-кандидатов.
 */
function createInitialRooms(rng, roomCount) {
    const rooms = [];
    const candidateCount = Math.floor(roomCount * 1.4);
    const rBase = 3.5 * Math.sqrt(roomCount);

    for (let i = 0; i < candidateCount; i++) {
        let arch = 'small';
        let w = 0, h = 0;
        
        // Гарантируем как минимум 2 большие комнаты (для босса и входа/элиты)
        if (i < 2) {
            arch = 'large';
        } else {
            const roll = rng.next();
            if (roll < 0.45) {
                arch = 'small';
            } else if (roll < 0.85) {
                arch = 'medium';
            } else {
                arch = 'large';
            }
        }

        if (arch === 'small') {
            w = rng.int(5, 8);
            h = rng.int(5, 8);
        } else if (arch === 'medium') {
            w = rng.int(8, 13);
            h = rng.int(8, 13);
        } else {
            w = rng.int(13, 19);
            h = rng.int(13, 19);
        }

        const r = rBase * Math.sqrt(rng.next());
        const theta = rng.next() * Math.PI * 2;
        const cx = r * Math.cos(theta);
        const cy = r * Math.sin(theta);

        const shapeRoll = rng.next();
        let shape = 'rectangle';
        if (shapeRoll < 0.60) shape = 'rectangle';
        else if (shapeRoll < 0.82) shape = 'ellipse';
        else shape = 'octagon';

        rooms.push({
            id: i,
            cx,
            cy,
            w,
            h,
            shape,
            type: 'combat',
            difficulty: 0,
            depth: -1,
            degree: 0
        });
    }
    return rooms;
}

/**
 * Физическая симуляция расталкивания комнат на основе AABB.
 */
function separateRooms(rooms, maxIterations = 300) {
    const padding = 2;
    let stable = false;

    for (let iter = 0; iter < maxIterations; iter++) {
        let shifted = false;
        for (let i = 0; i < rooms.length; i++) {
            for (let j = i + 1; j < rooms.length; j++) {
                const r1 = rooms[i];
                const r2 = rooms[j];

                const minDistX = (r1.w + r2.w) * 0.5 + padding;
                const minDistY = (r1.h + r2.h) * 0.5 + padding;

                const dx = r2.cx - r1.cx;
                const dy = r2.cy - r1.cy;
                const absDx = Math.abs(dx);
                const absDy = Math.abs(dy);

                if (absDx < minDistX && absDy < minDistY) {
                    shifted = true;
                    const overlapX = minDistX - absDx;
                    const overlapY = minDistY - absDy;

                    if (overlapX < overlapY) {
                        const pushX = overlapX * 0.5 + 0.01;
                        const sign = dx >= 0 ? 1 : -1;
                        r2.cx += pushX * sign;
                        r1.cx -= pushX * sign;
                    } else {
                        const pushY = overlapY * 0.5 + 0.01;
                        const sign = dy >= 0 ? 1 : -1;
                        r2.cy += pushY * sign;
                        r1.cy -= pushY * sign;
                    }
                }
            }
        }
        if (!shifted) {
            stable = true;
            break;
        }
    }

    for (let r of rooms) {
        r.cx = Math.round(r.cx);
        r.cy = Math.round(r.cy);
    }
}

/**
 * Проверка попадания точки в описанную окружность треугольника.
 */
function inCircumcircle(p, p1, p2, p3) {
    const ax = p1.x - p.x;
    const ay = p1.y - p.y;
    const bx = p2.x - p.x;
    const by = p2.y - p.y;
    const cx = p3.x - p.x;
    const cy = p3.y - p.y;

    const abdet = ax * by - bx * ay;
    const bcdet = bx * cy - cx * by;
    const cadet = cx * ay - ax * cy;

    const alensq = ax * ax + ay * ay;
    const blensq = bx * bx + by * by;
    const clensq = cx * cx + cy * cy;

    const circumdet = alensq * bcdet + blensq * cadet + clensq * abdet;
    const area = ax * (by - cy) + bx * (cy - ay) + cx * (ay - by);

    return area < 0 ? circumdet < 0 : circumdet > 0;
}

/**
 * Триангуляция Делоне методом Бойера-Ватсона.
 */
function delaunayTriangulation(rooms) {
    const vertices = rooms.map(r => ({ x: r.cx, y: r.cy, id: r.id }));
    if (vertices.length < 3) return [];

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let v of vertices) {
        minX = Math.min(minX, v.x); minY = Math.min(minY, v.y);
        maxX = Math.max(maxX, v.x); maxY = Math.max(maxY, v.y);
    }

    const dx = maxX - minX;
    const dy = maxY - minY;
    const deltaMax = Math.max(dx, dy);
    const midX = (minX + maxX) * 0.5;
    const midY = (minY + maxY) * 0.5;

    const p1 = { x: midX - 20 * deltaMax, y: midY - deltaMax, id: -1 };
    const p2 = { x: midX, y: midY + 20 * deltaMax, id: -2 };
    const p3 = { x: midX + 20 * deltaMax, y: midY - deltaMax, id: -3 };

    let triangles = [{ p1, p2, p3 }];

    for (let v of vertices) {
        let badTriangles = [];
        for (let t of triangles) {
            if (inCircumcircle(v, t.p1, t.p2, t.p3)) {
                badTriangles.push(t);
            }
        }

        let polygon = [];
        for (let t of badTriangles) {
            const edges = [
                { a: t.p1, b: t.p2 },
                { a: t.p2, b: t.p3 },
                { a: t.p3, b: t.p1 }
            ];
            for (let edge of edges) {
                let shared = false;
                for (let otherT of badTriangles) {
                    if (otherT === t) continue;
                    if ((edge.a.id === otherT.p1.id && edge.b.id === otherT.p2.id) || (edge.a.id === otherT.p2.id && edge.b.id === otherT.p1.id) ||
                        (edge.a.id === otherT.p2.id && edge.b.id === otherT.p3.id) || (edge.a.id === otherT.p3.id && edge.b.id === otherT.p2.id) ||
                        (edge.a.id === otherT.p3.id && edge.b.id === otherT.p1.id) || (edge.a.id === otherT.p1.id && edge.b.id === otherT.p3.id)) {
                        shared = true;
                        break;
                    }
                }
                if (!shared) {
                    polygon.push(edge);
                }
            }
        }

        triangles = triangles.filter(t => !badTriangles.includes(t));

        for (let edge of polygon) {
            triangles.push({ p1: edge.a, p2: edge.b, p3: v });
        }
    }

    triangles = triangles.filter(t => t.p1.id >= 0 && t.p2.id >= 0 && t.p3.id >= 0);

    const edges = [];
    const seen = new Set();
    for (let t of triangles) {
        const trEdges = [
            { a: t.p1.id, b: t.p2.id },
            { a: t.p2.id, b: t.p3.id },
            { a: t.p3.id, b: t.p1.id }
        ];
        for (let e of trEdges) {
            const u = Math.min(e.a, e.b);
            const v = Math.max(e.a, e.b);
            const key = `${u}-${v}`;
            if (!seen.has(key)) {
                seen.add(key);
                const rA = rooms.find(r => r.id === u);
                const rB = rooms.find(r => r.id === v);
                edges.push({
                    a: u,
                    b: v,
                    dist: Math.hypot(rA.cx - rB.cx, rA.cy - rB.cy),
                    isLoop: false,
                    isCritical: false
                });
            }
        }
    }
    return edges;
}

/**
 * Построение MST алгоритмом Прима.
 */
function computePrimMST(rooms, delaunayEdges) {
    const inMst = new Set([rooms[0].id]);
    const mstEdges = [];
    const remainingEdges = [];

    delaunayEdges.sort((x, y) => x.dist - y.dist || x.a - y.a || x.b - y.b);

    while (inMst.size < rooms.length) {
        let minEdge = null;
        for (let e of delaunayEdges) {
            const uIn = inMst.has(e.a);
            const vIn = inMst.has(e.b);
            if (uIn !== vIn) {
                minEdge = e;
                break;
            }
        }
        if (!minEdge) break;
        mstEdges.push(minEdge);
        inMst.add(minEdge.a);
        inMst.add(minEdge.b);
    }

    const mstKeys = new Set(mstEdges.map(e => `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`));
    for (let e of delaunayEdges) {
        const key = `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`;
        if (!mstKeys.has(key)) {
            remainingEdges.push(e);
        }
    }

    return { mstEdges, remainingEdges };
}

/**
 * Разметка типов комнат и критического пути.
 */
function resolveSemanticsAndPacing(rng, rooms, finalEdges) {
    const adj = Array.from({ length: rooms.length }, () => []);
    for (let e of finalEdges) {
        adj[e.a].push(e.b);
        adj[e.b].push(e.a);
    }

    let bossRoom = rooms[0];
    for (let r of rooms) {
        if ((r.w * r.h) > (bossRoom.w * bossRoom.h)) {
            bossRoom = r;
        }
    }
    bossRoom.type = 'boss';

    const bfsDist = new Array(rooms.length).fill(-1);
    const parent = new Array(rooms.length).fill(-1);
    const queue = [bossRoom.id];
    bfsDist[bossRoom.id] = 0;

    while (queue.length > 0) {
        const curr = queue.shift();
        for (let neighbor of adj[curr]) {
            if (bfsDist[neighbor] === -1) {
                bfsDist[neighbor] = bfsDist[curr] + 1;
                parent[neighbor] = curr;
                queue.push(neighbor);
            }
        }
    }

    let entranceRoom = null;
    let maxDist = -1;
    for (let r of rooms) {
        if (r.id === bossRoom.id) continue;
        const isAdjacentToBoss = adj[bossRoom.id].includes(r.id);
        const degree = adj[r.id].length;

        if (degree === 1 && !isAdjacentToBoss) {
            if (bfsDist[r.id] > maxDist) {
                maxDist = bfsDist[r.id];
                entranceRoom = r;
            }
        }
    }

    if (!entranceRoom) {
        for (let r of rooms) {
            if (r.id !== bossRoom.id && bfsDist[r.id] > maxDist) {
                maxDist = bfsDist[r.id];
                entranceRoom = r;
            }
        }
    }

    entranceRoom.type = 'entrance';

    const criticalPathRooms = new Set();
    let trace = entranceRoom.id;
    while (trace !== -1) {
        criticalPathRooms.add(trace);
        trace = parent[trace];
    }

    for (let e of finalEdges) {
        if (criticalPathRooms.has(e.a) && criticalPathRooms.has(e.b)) {
            if (parent[e.a] === e.b || parent[e.b] === e.a) {
                e.isCritical = true;
            }
        }
    }

    const entranceBfs = new Array(rooms.length).fill(-1);
    const entQueue = [entranceRoom.id];
    entranceBfs[entranceRoom.id] = 0;
    let maxEntDepth = 0;

    while (entQueue.length > 0) {
        const curr = entQueue.shift();
        for (let neighbor of adj[curr]) {
            if (entranceBfs[neighbor] === -1) {
                entranceBfs[neighbor] = entranceBfs[curr] + 1;
                maxEntDepth = Math.max(maxEntDepth, entranceBfs[neighbor]);
                entQueue.push(neighbor);
            }
        }
    }

    const leaves = [];
    const midDepthCandidates = [];
    for (let r of rooms) {
        r.depth = entranceBfs[r.id];
        r.difficulty = 0.15 + 0.85 * (r.depth / (maxEntDepth || 1));
        if (r.type === 'boss') r.difficulty = 1.0;

        if (r.id === entranceRoom.id || r.id === bossRoom.id) continue;

        if (adj[r.id].length === 1) {
            leaves.push(r);
        } else if (!criticalPathRooms.has(r.id)) {
            const normDepth = r.depth / (maxEntDepth || 1);
            if (normDepth >= 0.35 && normDepth <= 0.65) {
                midDepthCandidates.push(r);
            }
        }
    }

    leaves.sort((x, y) => y.id - x.id);
    const treasureRooms = leaves.slice(0, Math.min(leaves.length, 4));
    for (let r of treasureRooms) {
        r.type = 'treasure';
    }

    midDepthCandidates.sort((x, y) => x.id - y.id);
    const shrineCount = Math.min(midDepthCandidates.length, 2);
    for (let i = 0; i < shrineCount; i++) {
        midDepthCandidates[i].type = 'shrine';
    }

    const critRooms = rooms.filter(r => r.id !== entranceRoom.id && r.id !== bossRoom.id && criticalPathRooms.has(r.id));
    critRooms.sort((x, y) => x.depth - y.depth);

    for (let r of critRooms) {
        const ratio = r.depth / (maxEntDepth || 1);
        if (ratio >= 0.55 && ratio <= 0.85) {
            r.type = 'elite';
            break;
        }
    }

    return { entranceRoom, bossRoom, maxEntDepth, criticalPathRooms };
}

/**
 * Логика вырезания L-коридоров.
 */
function carveLCorridor(grid, W, H, ax, ay, bx, by, width, rng, corridorCells) {
    const overlapX = Math.abs(ax - bx) <= 1;
    const overlapY = Math.abs(ay - by) <= 1;

    const drawSegment = (x1, y1, x2, y2) => {
        const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
        const halfW = Math.floor((width - 1) * 0.5);

        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                if (x1 === x2) {
                    for (let dx = -halfW; dx <= halfW + ((width - 1) % 2); dx++) {
                        const px = x + dx;
                        if (px >= 0 && px < W && y >= 0 && y < H) {
                            const idx = y * W + px;
                            grid[idx] = FLOOR;
                            corridorCells.add(idx);
                        }
                    }
                } else {
                    for (let dy = -halfW; dy <= halfW + ((width - 1) % 2); dy++) {
                        const py = y + dy;
                        if (x >= 0 && x < W && py >= 0 && py < H) {
                            const idx = py * W + x;
                            grid[idx] = FLOOR;
                            corridorCells.add(idx);
                        }
                    }
                }
            }
        }
    };

    if (overlapX) {
        drawSegment(ax, ay, ax, by);
    } else if (overlapY) {
        drawSegment(ax, ay, bx, ay);
    } else {
        if (rng.chance(0.5)) {
            drawSegment(ax, ay, bx, ay);
            drawSegment(bx, ay, bx, by);
        } else {
            drawSegment(ax, ay, ax, by);
            drawSegment(ax, by, bx, by);
        }
    }
}

/**
 * Единый пусковой метод для попытки генерации подземелья.
 */
function runPipelineAttempt(params, rng, seed) {
    const roomCount = params.roomCount || 42;
    const loopChance = params.loopChance !== undefined ? params.loopChance : 0.15;
    const decorDensity = params.decorDensity !== undefined ? params.decorDensity : 0.6;

    let rooms = createInitialRooms(rng, roomCount);

    separateRooms(rooms, 300);

    rooms.sort((x, y) => (y.w * y.h) - (x.w * x.h));
    rooms = rooms.slice(0, roomCount);

    // ФИКС: Переиндексируем оставшиеся комнаты последовательно
    for (let i = 0; i < rooms.length; i++) {
        rooms[i].id = i;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let r of rooms) {
        minX = Math.min(minX, r.cx - r.w * 0.5);
        maxX = Math.max(maxX, r.cx + r.w * 0.5);
        minY = Math.min(minY, r.cy - r.h * 0.5);
        maxY = Math.max(maxY, r.cy + r.h * 0.5);
    }

    const originX = Math.floor(minX) - 5;
    const originY = Math.floor(minY) - 5;
    const W = Math.ceil(maxX) - originX + 5;
    const H = Math.ceil(maxY) - originY + 5;

    for (let r of rooms) {
        r.cx -= originX;
        r.cy -= originY;
    }

    const delaunayEdges = delaunayTriangulation(rooms);
    const { mstEdges, remainingEdges } = computePrimMST(rooms, delaunayEdges);

    const finalEdges = [...mstEdges];
    let loopCount = 0;

    if (remainingEdges.length > 0) {
        const sumMst = mstEdges.reduce((acc, e) => acc + e.dist, 0);
        const meanMst = sumMst / (mstEdges.length || 1);

        for (let e of remainingEdges) {
            if (e.dist <= 2.2 * meanMst) {
                if (rng.chance(loopChance)) {
                    e.isLoop = true;
                    finalEdges.push(e);
                    loopCount++;
                }
            }
        }

        if (loopCount === 0) {
            const validSpurs = remainingEdges.filter(e => e.dist <= 2.2 * meanMst);
            if (validSpurs.length > 0) {
                validSpurs[0].isLoop = true;
                finalEdges.push(validSpurs[0]);
                loopCount = 1;
            }
        }
    }

    const { entranceRoom, bossRoom, maxEntDepth, criticalPathRooms } = resolveSemanticsAndPacing(rng, rooms, finalEdges);

    const grid = new Uint8Array(W * H);
    const corridorCells = new Set();

    for (let r of rooms) {
        const rx1 = Math.round(r.cx - r.w * 0.5);
        const rx2 = Math.round(r.cx + r.w * 0.5);
        const ry1 = Math.round(r.cy - r.h * 0.5);
        const ry2 = Math.round(r.cy + r.h * 0.5);

        for (let y = ry1; y < ry2; y++) {
            for (let x = rx1; x < rx2; x++) {
                if (x < 0 || x >= W || y < 0 || y >= H) continue;

                let isInside = false;
                if (r.shape === 'rectangle') {
                    isInside = true;
                } else if (r.shape === 'ellipse') {
                    const dx = (x - r.cx) / (r.w * 0.5);
                    const dy = (y - r.cy) / (r.h * 0.5);
                    isInside = (dx * dx + dy * dy) <= 1.0;
                } else {
                    const dx = Math.abs(x - r.cx) / (r.w * 0.5);
                    const dy = Math.abs(y - r.cy) / (r.h * 0.5);
                    isInside = (dx + dy) <= 1.35 && dx <= 0.95 && dy <= 0.95;
                }

                if (isInside) {
                    grid[y * W + x] = FLOOR;
                }
            }
        }
    }

    for (let e of finalEdges) {
        const rA = rooms.find(r => r.id === e.a);
        const rB = rooms.find(r => r.id === e.b);
        let w = 2;
        if (e.isCritical) w = 3;
        else if (rA.type === 'treasure' || rB.type === 'treasure') w = 1;

        carveLCorridor(grid, W, H, Math.round(rA.cx), Math.round(rA.cy), Math.round(rB.cx), Math.round(rB.cy), w, rng, corridorCells);
    }

    const doorways = [];
    const isInsideAnyRoom = (x, y) => {
        for (let r of rooms) {
            const hx = r.w * 0.5;
            const hy = r.h * 0.5;
            if (x >= r.cx - hx && x < r.cx + hx && y >= r.cy - hy && y < r.cy + hy) {
                return r.id;
            }
        }
        return -1;
    };

    for (let idx of corridorCells) {
        const x = idx % W;
        const y = Math.floor(idx / W);
        let isDoor = false;

        const neighbors = [
            { x: x + 1, y }, { x: x - 1, y },
            { x, y: y + 1 }, { x, y: y - 1 }
        ];

        let adjacentRoomId = -1;
        for (let n of neighbors) {
            if (n.x >= 0 && n.x < W && n.y >= 0 && n.y < H) {
                const nIdx = n.y * W + n.x;
                if (grid[nIdx] === FLOOR && !corridorCells.has(nIdx)) {
                    adjacentRoomId = isInsideAnyRoom(n.x, n.y);
                    if (adjacentRoomId !== -1) {
                        isDoor = true;
                        break;
                    }
                }
            }
        }

        if (isDoor) {
            doorways.push({ x, y, roomId: adjacentRoomId });
        }
    }

    const wallsSet = new Set();
    for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
            const idx = y * W + x;
            if (grid[idx] === VOID) {
                let touchesFloor = false;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (grid[(y + dy) * W + (x + dx)] === FLOOR) {
                            touchesFloor = true;
                            break;
                        }
                    }
                    if (touchesFloor) break;
                }
                if (touchesFloor) {
                    wallsSet.add(idx);
                }
            }
        }
    }

    for (let idx of wallsSet) {
        grid[idx] = WALL;
    }

    const bfs = new Int16Array(W * H).fill(-1);
    const entCenterIdx = Math.round(entranceRoom.cy) * W + Math.round(entranceRoom.cx);
    const queueGrid = [entCenterIdx];
    bfs[entCenterIdx] = 0;

    let maxGridBfs = 0;
    while (queueGrid.length > 0) {
        const currIdx = queueGrid.shift();
        const cx = currIdx % W;
        const cy = Math.floor(currIdx / W);
        const currentDist = bfs[currIdx];

        const neighbors = [
            { x: cx + 1, y: cy }, { x: cx - 1, y: cy },
            { x: cx, y: cy + 1 }, { x: cx, y: cy - 1 }
        ];

        for (let n of neighbors) {
            if (n.x >= 0 && n.x < W && n.y >= 0 && n.y < H) {
                const nIdx = n.y * W + n.x;
                if (grid[nIdx] === FLOOR && bfs[nIdx] === -1) {
                    bfs[nIdx] = currentDist + 1;
                    maxGridBfs = Math.max(maxGridBfs, bfs[nIdx]);
                    queueGrid.push(nIdx);
                }
            }
        }
    }

    let totalFloors = 0;
    let reachedFloors = 0;
    for (let i = 0; i < W * H; i++) {
        if (grid[i] === FLOOR) {
            totalFloors++;
            if (bfs[i] !== -1) reachedFloors++;
        }
    }

    if (reachedFloors !== totalFloors) {
        throw new Error(`Connectivity mismatch: Flood fill reached ${reachedFloors}/${totalFloors} floor tiles.`);
    }

    const props = [];
    const spawns = [];
    const doorSet = new Set(doorways.map(d => `${d.x}-${d.y}`));

    const occupiesCell = (x, y) => {
        if (x < 0 || x >= W || y < 0 || y >= H) return true;
        if (grid[y * W + x] !== FLOOR) return true;
        if (doorSet.has(`${x}-${y}`)) return true;
        return props.some(p => p.x === x && p.y === y) || spawns.some(s => s.x === x && s.y === y);
    };

    for (let r of rooms) {
        const cx = Math.round(r.cx);
        const cy = Math.round(r.cy);

        if (r.type === 'entrance') {
            props.push({ kind: 'portal', x: cx, y: cy, roomId: r.id, rot: 0, scale: 1.0 });
        } else if (r.type === 'shrine') {
            props.push({ kind: 'crystal', x: cx, y: cy, roomId: r.id, rot: rng.float(0, Math.PI), scale: 1.1 });
        } else if (r.type === 'treasure') {
            props.push({ kind: 'chest', x: cx, y: cy, roomId: r.id, rot: rng.pick([0, Math.PI * 0.5, Math.PI, Math.PI * 1.5]), scale: 0.95 });
        } else if (r.type === 'boss') {
            const offsets = [{ dx: -2, dy: -2 }, { dx: 2, dy: -2 }, { dx: -2, dy: 2 }, { dx: 2, dy: 2 }];
            for (let off of offsets) {
                const px = cx + off.dx;
                const py = cy + off.dy;
                if (!occupiesCell(px, py)) {
                    props.push({ kind: 'brazier', x: px, y: py, roomId: r.id, rot: 0, scale: 1.2 });
                }
            }
        }

        if ((r.w >= 13 || r.h >= 13) && r.type !== 'boss') {
            const stepX = r.w >= 15 ? 4 : 3;
            const stepY = r.h >= 15 ? 4 : 3;
            const rx1 = Math.round(r.cx - r.w * 0.5) + 2;
            const rx2 = Math.round(r.cx + r.w * 0.5) - 2;
            const ry1 = Math.round(r.cy - r.h * 0.5) + 2;
            const ry2 = Math.round(r.cy + r.h * 0.5) - 2;

            for (let py = ry1; py < ry2; py += stepY) {
                for (let px = rx1; px < rx2; px += stepX) {
                    if (!occupiesCell(px, py)) {
                        let ok = true;
                        for (let dy = -1; dy <= 1; dy++) {
                            for (let dx = -1; dx <= 1; dx++) {
                                if (grid[(py + dy) * W + (px + dx)] !== FLOOR) ok = false;
                            }
                        }
                        if (ok) {
                            props.push({ kind: 'pillar', x: px, y: py, roomId: r.id, rot: rng.float(0, 0.2), scale: 1.0 });
                        }
                    }
                }
            }
        }

        if (r.type !== 'entrance' && r.type !== 'shrine' && r.type !== 'treasure') {
            const area = r.w * r.h;
            const count = Math.round((area / 18) * (0.5 + r.difficulty));
            let attempts = 0;
            let spawned = 0;

            while (spawned < count && attempts < 100) {
                attempts++;
                const px = rng.int(Math.round(r.cx - r.w * 0.5) + 1, Math.round(r.cx + r.w * 0.5));
                const py = rng.int(Math.round(r.cy - r.h * 0.5) + 1, Math.round(r.cy + r.h * 0.5));

                if (!occupiesCell(px, py) && Math.hypot(px - r.cx, py - r.cy) > 1.5) {
                    const tier = r.type === 'boss' ? 'boss' : (r.type === 'elite' ? 'elite' : (rng.chance(0.15) ? 'champion' : 'minion'));
                    spawns.push({ x: px, y: py, tier, roomId: r.id });
                    spawned++;
                }
            }
        }
    }

    for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
            const idx = y * W + x;
            if (grid[idx] === FLOOR && !occupiesCell(x, y)) {
                let diffCoeff = 1.0;
                const currentRoomId = isInsideAnyRoom(x, y);
                if (currentRoomId !== -1) {
                    const rm = rooms.find(r => r.id === currentRoomId);
                    diffCoeff = 1.2 - rm.difficulty * 0.5;
                }

                if (rng.chance(decorDensity * 0.08 * diffCoeff)) {
                    props.push({ kind: 'debris', x, y, roomId: currentRoomId, rot: rng.float(0, Math.PI * 2), scale: rng.float(0.7, 1.2) });
                }
            }
        }
    }

    const torches = [];
    for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
            const idx = y * W + x;
            if (grid[idx] === WALL) {
                if (grid[(y - 1) * W + x] === FLOOR) {
                    let ok = true;
                    for (let t of torches) {
                        if (Math.max(Math.abs(t.x - x), Math.abs(t.y - y)) < 4) {
                            ok = false;
                            break;
                        }
                    }
                    if (ok) {
                        torches.push({ x, y, wallIdx: idx });
                        props.push({ kind: 'torch', x, y, roomId: isInsideAnyRoom(x, y - 1), rot: 0, scale: 1.0 });
                    }
                }
            }
        }
    }

    const name = `${rng.pick(SYLLABLE_ADJ)} ${rng.pick(SYLLABLE_NOUN)} ${rng.pick(SYLLABLE_NAME)}`;

    let floorTilesCount = 0;
    let wallTilesCount = 0;
    for (let i = 0; i < W * H; i++) {
        if (grid[i] === FLOOR) floorTilesCount++;
        if (grid[i] === WALL) wallTilesCount++;
    }

    const stats = {
        rooms: rooms.length,
        edges: finalEdges.length,
        loops: loopCount,
        criticalLength: criticalPathRooms.size,
        floorTiles: floorTilesCount,
        wallTiles: wallTilesCount,
        props: props.length,
        spawns: spawns.length,
        maxBfs: maxGridBfs,
        genMs: 0,
        retries: 0
    };

    return {
        params, name, W, H, grid, bfs, rooms,
        edges: finalEdges, delaunayEdges, doorways,
        props, spawns, stats
    };
}

/**
 * Внешний экспортируемый API-интерфейс генератора подземелий.
 */
export function generateDungeon(params) {
    const startTime = performance.now();
    let attempt = 0;
    let success = false;
    let dungeonResult = null;

    while (attempt < 5 && !success) {
        const currentSeed = (getSeedHash(params.seed) + attempt * 27541) & 0xffffffff;
        const rng = new SeededRNG(currentSeed);

        try {
            dungeonResult = runPipelineAttempt(params, rng, currentSeed);
            success = true;
        } catch (e) {
            console.warn(`Попытка генерации ${attempt + 1} завершилась неудачей. Смена сида...`, e.message);
            attempt++;
        }
    }

    if (!success || !dungeonResult) {
        throw new Error("Не удалось сгенерировать подземелье. Превышен лимит попыток связности.");
    }

    dungeonResult.stats.genMs = performance.now() - startTime;
    dungeonResult.stats.retries = attempt;
    return dungeonResult;
}
