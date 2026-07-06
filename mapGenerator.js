import { PRNG } from './prng.js';

export class MapGenerator {
    constructor(width = 30, height = 30, prng) {
        this.width = width;
        this.height = height;
        this.prng = prng || new PRNG();
    }

    generate(roomAttempts = 12) {
        let attempts = 0;
        while (attempts < 5) {
            const map = this._tryGenerate(roomAttempts);
            if (map) return map;
            attempts++;
            this.prng.reseed("retry_" + attempts + "_" + Math.floor(this.prng.next() * 1000000));
        }
        return this._generateFallback();
    }

    _tryGenerate(roomAttempts) {
        const grid = Array(this.height).fill(0).map(() => Array(this.width).fill(0));
        const rooms = [];

        for (let i = 0; i < roomAttempts; i++) {
            const w = this.prng.rangeInt(4, 8);
            const h = this.prng.rangeInt(4, 8);
            const x = this.prng.rangeInt(1, this.width - w - 1);
            const y = this.prng.rangeInt(1, this.height - h - 1);

            let overlap = false;
            for (const r of rooms) {
                if (x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y) {
                    overlap = true;
                    break;
                }
            }
            if (!overlap) {
                rooms.push({ x, y, w, h });
            }
        }

        if (rooms.length < 2) return null;

        // Рисуем полы комнат
        rooms.forEach(r => {
            for (let y = r.y; y < r.y + r.h; y++) {
                for (let x = r.x; x < r.x + r.w; x++) {
                    grid[y][x] = 1; // FLOOR
                }
            }
        });

        // Создаем коридоры для связывания комнат
        for (let i = 0; i < rooms.length - 1; i++) {
            const r1 = rooms[i];
            const r2 = rooms[i + 1];
            this._drawCorridor(grid, r1.x + Math.floor(r1.w / 2), r1.y + Math.floor(r1.h / 2),
                                     r2.x + Math.floor(r2.w / 2), r2.y + Math.floor(r2.h / 2));
        }

        // Обносим все полы стенами
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (grid[y][x] === 0) {
                    if (this._hasAdjacentFloor(grid, x, y)) {
                        grid[y][x] = 2; // WALL
                    }
                }
            }
        }

        // Валидация связности с помощью BFS
        const startRoom = rooms[0];
        const startX = startRoom.x + Math.floor(startRoom.w / 2);
        const startY = startRoom.y + Math.floor(startRoom.h / 2);

        if (!this._verifyConnectivity(grid, startX, startY)) {
            return null; // Требуется перезапуск
        }

        // Строгая переиндексация комнат
        const finalizedRooms = rooms.map((r, index) => ({
            id: index,
            x: r.x, y: r.y, w: r.w, h: r.h,
            cx: r.x + Math.floor(r.w / 2),
            cy: r.y + Math.floor(r.h / 2)
        }));

        const occupied = new Set();
        const markOccupied = (x, y) => occupied.add(`${x},${y}`);
        const isOccupied = (x, y) => occupied.has(`${x},${y}`);

        // Игрок стартует в центре первой комнаты
        const playerSpawn = { x: finalizedRooms[0].cx, y: finalizedRooms[0].cy };
        markOccupied(playerSpawn.x, playerSpawn.y);

        // Портал располагается в самой последней комнате
        const lastRoom = finalizedRooms[finalizedRooms.length - 1];
        const portal = { x: lastRoom.cx, y: lastRoom.cy };
        markOccupied(portal.x, portal.y);

        // Размещаем сундуки по углам комнат
        const chests = [];
        for (let i = 1; i < finalizedRooms.length; i++) {
            const r = finalizedRooms[i];
            const corners = [
                { x: r.x, y: r.y },
                { x: r.x + r.w - 1, y: r.y },
                { x: r.x, y: r.y + r.h - 1 },
                { x: r.x + r.w - 1, y: r.y + r.h - 1 }
            ];
            for (const corner of corners) {
                if (!isOccupied(corner.x, corner.y) && grid[corner.y][corner.x] === 1) {
                    chests.push({ x: corner.x, y: corner.y });
                    markOccupied(corner.x, corner.y);
                    break;
                }
            }
        }

        // Распределяем монстров
        const monsters = [];
        const monsterTypes = ["Guard", "Patrol", "Wander"];
        for (let i = 1; i < finalizedRooms.length; i++) {
            const r = finalizedRooms[i];
            const numMonsters = this.prng.rangeInt(1, 3);
            for (let m = 0; m < numMonsters; m++) {
                const mx = this.prng.rangeInt(r.x + 1, r.x + r.w - 1);
                const my = this.prng.rangeInt(r.y + 1, r.y + r.h - 1);
                if (!isOccupied(mx, my) && grid[my][mx] === 1) {
                    const aiType = this.prng.choose(monsterTypes);
                    let patrolPath = null;
                    if (aiType === "Patrol") {
                        patrolPath = [];
                        const isVert = this.prng.next() > 0.5;
                        for (let step = -2; step <= 2; step++) {
                            const px = mx + (isVert ? 0 : step);
                            const py = my + (isVert ? step : 0);
                            if (grid[py] && grid[py][px] === 1) {
                                patrolPath.push({ x: px, y: py });
                            }
                        }
                    }
                    monsters.push({
                        id: `monster_${i}_${m}`,
                        x: mx, y: my,
                        aiType,
                        patrolPath,
                        patrolIndex: 0,
                        patrolDir: 1,
                        state: "Idle",
                        stats: {
                            maxHp: 15, hp: 15,
                            maxPa: 4, pa: 4,
                            maxMa: 4, ma: 4,
                            fight: 4
                        }
                    });
                    markOccupied(mx, my);
                }
            }
        }

        return {
            grid,
            rooms: finalizedRooms,
            playerSpawn,
            portal,
            chests,
            monsters
        };
    }

    _drawCorridor(grid, x1, y1, x2, y2) {
        let cx = x1;
        let cy = y1;
        while (cx !== x2) {
            grid[cy][cx] = 1;
            cx += (x2 > x1) ? 1 : -1;
        }
        while (cy !== y2) {
            grid[cy][cx] = 1;
            cy += (y2 > y1) ? 1 : -1;
        }
    }

    _hasAdjacentFloor(grid, x, y) {
        const directions = [
            [-1, -1], [0, -1], [1, -1],
            [-1, 0],          [1, 0],
            [-1, 1],  [0, 1],  [1, 1]
        ];
        for (const [dx, dy] of directions) {
            const nx = x + dx;
            const ny = y + dy;
            if (ny >= 0 && ny < this.height && nx >= 0 && nx < this.width) {
                if (grid[ny][nx] === 1) return true;
            }
        }
        return false;
    }

    _verifyConnectivity(grid, startX, startY) {
        const visited = Array(this.height).fill(0).map(() => Array(this.width).fill(false));
        const queue = [{ x: startX, y: startY }];
        visited[startY][startX] = true;
        let visitedCount = 0;

        let totalFloorCount = 0;
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (grid[y][x] === 1) totalFloorCount++;
            }
        }

        const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]];

        while (queue.length > 0) {
            const curr = queue.shift();
            visitedCount++;

            for (const [dx, dy] of directions) {
                const nx = curr.x + dx;
                const ny = curr.y + dy;
                if (ny >= 0 && ny < this.height && nx >= 0 && nx < this.width) {
                    if (grid[ny][nx] === 1 && !visited[ny][nx]) {
                        visited[ny][nx] = true;
                        queue.push({ x: nx, y: ny });
                    }
                }
            }
        }
        return visitedCount === totalFloorCount;
    }

    _generateFallback() {
        const grid = Array(10).fill(0).map(() => Array(10).fill(0));
        for (let y = 2; y <= 7; y++) {
            for (let x = 2; x <= 7; x++) {
                grid[y][x] = 1;
            }
        }
        for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 10; x++) {
                if (grid[y][x] === 0 && this._hasAdjacentFloor(grid, x, y)) {
                    grid[y][x] = 2;
                }
            }
        }
        return {
            grid,
            rooms: [{ id: 0, x: 2, y: 2, w: 6, h: 6, cx: 4, cy: 4 }],
            playerSpawn: { x: 4, y: 4 },
            portal: { x: 5, y: 5 },
            chests: [],
            monsters: []
        };
    }
}
