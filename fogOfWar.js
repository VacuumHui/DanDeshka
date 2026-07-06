export class FogOfWar {
    constructor(grid, sceneBuilder) {
        this.grid = grid;
        this.sceneBuilder = sceneBuilder;
        this.h = grid.length;
        this.w = grid[0].length;
        this.visibleSet = new Set();
    }

    updateFOV(px, py, dirX, dirY) {
        const nextVisible = new Set();
        const maxRadius = 9; 
        const minX = Math.max(0, px - maxRadius);
        const maxX = Math.min(this.w - 1, px + maxRadius);
        const minY = Math.max(0, py - maxRadius);
        const maxY = Math.min(this.h - 1, py + maxRadius);

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const dist = Math.hypot(x - px, y - py);
                if (dist > 8.5) continue; 

                let visible = false;

                if (dist <= 2.5) {
                    // Конус обзора: по кругу 360° до 2.5 клеток
                    if (this._hasLineOfSight(px, py, x, y)) {
                        visible = true;
                    }
                } else {
                    // Сужение обзора до 90° в направлении взгляда от 2.5 до 8.5 клеток
                    const dirLen = Math.hypot(dirX, dirY);
                    const ndx = dirX / (dirLen || 1);
                    const ndy = dirY / (dirLen || 1);

                    const tx = x - px;
                    const ty = y - py;
                    const tLen = Math.hypot(tx, ty);
                    const ntx = tx / (tLen || 1);
                    const nty = ty / (tLen || 1);

                    const dot = ndx * ntx + ndy * nty;
                    if (dot >= 0.7071) { // cos(45°) = 0.7071 (общий угол 90°)
                        if (this._hasLineOfSight(px, py, x, y)) {
                            visible = true;
                        }
                    }
                }

                if (visible) {
                    nextVisible.add(`${x},${y}`);
                }
            }
        }

        nextVisible.forEach(key => {
            if (!this.visibleSet.has(key)) {
                const [x, y] = key.split(',').map(Number);
                this.sceneBuilder.setTileVisibility(x, y, true);
                this.sceneBuilder.setTileVisibility(x, y, true, 'portal');
                this.sceneBuilder.setTileVisibility(x, y, true, 'chest');
            }
        });

        this.visibleSet.forEach(key => {
            if (!nextVisible.has(key)) {
                const [x, y] = key.split(',').map(Number);
                this.sceneBuilder.setTileVisibility(x, y, false);
                this.sceneBuilder.setTileVisibility(x, y, false, 'portal');
                this.sceneBuilder.setTileVisibility(x, y, false, 'chest');
            }
        });

        this.visibleSet = nextVisible;
    }

    _hasLineOfSight(x0, y0, x1, y1) {
        let dx = Math.abs(x1 - x0);
        let dy = Math.abs(y1 - y0);
        let sx = (x0 < x1) ? 1 : -1;
        let sy = (y0 < y1) ? 1 : -1;
        let err = dx - dy;

        let cx = x0;
        let cy = y0;

        while (true) {
            if (cx === x1 && cy === y1) return true;

            if (cx !== x0 || cy !== y0) {
                if (this.grid[cy] && this.grid[cy][cx] === 2) { 
                    return false;
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
    }

    isCellVisible(x, y) {
        return this.visibleSet.has(`${x},${y}`);
    }
}
