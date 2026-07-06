export class AIController {
    constructor(grid, prng) {
        this.grid = grid;
        this.prng = prng;
        this.h = grid.length;
        this.w = grid[0].length;
    }

    computeNextMove(monster, playerX, playerY, monstersList) {
        const dist = Math.hypot(monster.x - playerX, monster.y - playerY);

        // Радиус скрытого агро ~3.8 тайла
        if (dist <= 3.8) {
            monster.state = "Chasing";
        }

        if (monster.state === "Chasing") {
            const nextStep = this._findPathBFS(monster.x, monster.y, playerX, playerY, monstersList);
            if (nextStep) {
                return nextStep;
            }
        }

        if (monster.aiType === "Guard") {
            return { x: monster.x, y: monster.y };
        } else if (monster.aiType === "Patrol") {
            return this._getPatrolStep(monster, monstersList);
        } else if (monster.aiType === "Wander") {
            // Случайный шаг на плитку FLOOR с вероятностью 30%
            if (this.prng.next() < 0.3) {
                return this._getWanderStep(monster, monstersList);
            }
        }

        return { x: monster.x, y: monster.y };
    }

    _findPathBFS(sx, sy, tx, ty, monstersList) {
        if (sx === tx && sy === ty) return { x: sx, y: sy };

        const queue = [[{ x: sx, y: sy }]];
        const visited = Array(this.h).fill(0).map(() => Array(this.w).fill(false));
        visited[sy][sx] = true;

        const directions = [
            { x: 0, y: 1 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: -1, y: 0 }
        ];

        while (queue.length > 0) {
            const path = queue.shift();
            const curr = path[path.length - 1];

            if (curr.x === tx && curr.y === ty) {
                return path[1] || { x: sx, y: sy };
            }

            for (const d of directions) {
                const nx = curr.x + d.x;
                const ny = curr.y + d.y;

                if (ny >= 0 && ny < this.h && nx >= 0 && nx < this.w) {
                    if (this.grid[ny][nx] === 1 && !visited[ny][nx]) {
                        visited[ny][nx] = true;
                        queue.push([...path, { x: nx, y: ny }]);
                    }
                }
            }
        }
        return null;
    }

    _getPatrolStep(monster, monstersList) {
        if (!monster.patrolPath || monster.patrolPath.length === 0) return { x: monster.x, y: monster.y };

        let idx = monster.patrolIndex + monster.patrolDir;
        if (idx < 0 || idx >= monster.patrolPath.length) {
            monster.patrolDir *= -1;
            idx = monster.patrolIndex + monster.patrolDir;
        }

        const step = monster.patrolPath[idx] || { x: monster.x, y: monster.y };
        
        if (this._isCellOccupiedByMonster(step.x, step.y, monster.id, monstersList)) {
            return { x: monster.x, y: monster.y };
        }

        monster.patrolIndex = idx;
        return step;
    }

    _getWanderStep(monster, monstersList) {
        const directions = [
            { x: 0, y: 1 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: -1, y: 0 }
        ];
        const valid = [];
        for (const d of directions) {
            const nx = monster.x + d.x;
            const ny = monster.y + d.y;
            if (ny >= 0 && ny < this.h && nx >= 0 && nx < this.w) {
                if (this.grid[ny][nx] === 1 && !this._isCellOccupiedByMonster(nx, ny, monster.id, monstersList)) {
                    valid.push({ x: nx, y: ny });
                }
            }
        }
        if (valid.length > 0) {
            return this.prng.choose(valid);
        }
        return { x: monster.x, y: monster.y };
    }

    _isCellOccupiedByMonster(x, y, selfId, monstersList) {
        return monstersList.some(m => m.id !== selfId && m.x === x && m.y === y);
    }
}
