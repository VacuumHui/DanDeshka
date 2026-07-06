import { SeededRNG } from './rng.js';

const WALL = 2;
const FLOOR = 1;

/**
 * Алгоритм поиска пути BFS на 2D-сетке для преследования игрока монстрами.
 */
function getNextStepBFS(grid, W, H, startX, startY, targetX, targetY) {
    if (startX === targetX && startY === targetY) return { x: startX, y: startY };
    
    const queue = [[startX, startY]];
    const visited = new Set([`${startX}-${startY}`]);
    const parent = {};

    const directions = [
        { x: 1, y: 0 }, { x: -1, y: 0 },
        { x: 0, y: 1 }, { x: 0, y: -1 }
    ];

    let reached = false;
    while (queue.length > 0) {
        const [cx, cy] = queue.shift();
        if (cx === targetX && cy === targetY) {
            reached = true;
            break;
        }

        for (let dir of directions) {
            const nx = cx + dir.x;
            const ny = cy + dir.y;
            const key = `${nx}-${ny}`;

            if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
                const idx = ny * W + nx;
                if (grid[idx] === FLOOR && !visited.has(key)) {
                    visited.add(key);
                    parent[key] = [cx, cy];
                    queue.push([nx, ny]);
                }
            }
        }
    }

    if (!reached) return { x: startX, y: startY };

    let curr = `${targetX}-${targetY}`;
    let path = [];
    while (curr) {
        const p = parent[curr];
        if (!p) break;
        path.push(curr);
        curr = `${p[0]}-${p[1]}`;
    }

    if (path.length === 0) return { x: startX, y: startY };
    const [fsX, fsY] = path[path.length - 1].split('-').map(Number);
    return { x: fsX, y: fsY };
}

/**
 * Фабрика сущностей для инициализации игрока и монстров с характеристиками брони.
 */
export class EntityFactory {
    static createPlayer(startX, startY) {
        return {
            x: startX,
            y: startY,
            dir: 0, // Направление взгляда персонажа в радианах
            hp: 20,
            maxHp: 20,
            pa: 5,   // Физическая броня (DOS2)
            maxPa: 5,
            ma: 5,   // Магическая броня (DOS2)
            maxMa: 5,
            fight: 5, // Базовый пул бросаемых кубиков
            gold: 0,
            cards: [] // Рука карт (макс 5)
        };
    }

    static createMonster(id, spawn, rng) {
        let maxHp = 10, maxPa = 2, maxMa = 2, fight = 4, state = 'idle';

        if (spawn.tier === 'boss') {
            maxHp = 30; maxPa = 10; maxMa = 10; fight = 6; state = 'guard';
        } else if (spawn.tier === 'elite') {
            maxHp = 18; maxPa = 5; maxMa = 5; fight = 5; state = 'wander';
        } else if (spawn.tier === 'champion') {
            maxHp = 12; maxPa = 3; maxMa = 3; fight = 4; state = 'patrol';
        } else { // minion
            maxHp = 8; maxPa = 1; maxMa = 1; fight = 3; state = rng.pick(['idle', 'wander']);
        }

        return {
            id,
            x: spawn.x,
            y: spawn.y,
            tier: spawn.tier,
            hp: maxHp,
            maxHp,
            pa: maxPa,
            maxPa,
            ma: maxMa,
            maxMa,
            fight,
            state, // idle, patrol, wander, guard, chasing
            anchorX: spawn.x,
            anchorY: spawn.y,
            patrolDir: 1, // 1 или -1 для хождения взад-вперед
            cards: [] // Монстры тоже могут обладать картами!
        };
    }
}

/**
 * Класс управления пошаговыми ходами и боевой механикой.
 */
export class CombatSystem {
    constructor(dungeon, seed) {
        this.dungeon = dungeon;
        this.rng = new SeededRNG(seed);
        this.player = null;
        this.monsters = [];
        this.combatLog = [];
    }

    /**
     * Спавн сущностей на карте.
     */
    spawnEntities() {
        this.player = EntityFactory.createPlayer(
            Math.round(this.dungeon.rooms[0].cx),
            Math.round(this.dungeon.rooms[0].cy)
        );

        this.monsters = this.dungeon.spawns.map((s, idx) => 
            EntityFactory.createMonster(idx, s, this.rng)
        );
    }

    /**
     * Пошаговый цикл. Выполняется при шаге игрока.
     * @param {number} dx - Шаг по оси X (-1, 0, 1)
     * @param {number} dy - Шаг по оси Y (-1, 0, 1)
     * @returns {Object} Результаты хода (случился ли бой, логи)
     */
    processStep(dx, dy) {
        const result = {
            combatTriggered: false,
            combatReport: null,
            events: []
        };

        if (dx !== 0 || dy !== 0) {
            // Разворачиваем игрока в направлении шага
            this.player.dir = Math.atan2(dy, dx);
        }

        const targetX = this.player.x + dx;
        const targetY = this.player.y + dy;

        // Проверяем проходимость клетки
        const idx = targetY * this.dungeon.W + targetX;
        if (this.dungeon.grid[idx] !== FLOOR) {
            result.events.push("Путь преграждает стена.");
            return result; // Шаг не совершен
        }

        // Проверяем столкновение с монстром на целевой клетке (Игрок нападает!)
        const targetMonster = this.monsters.find(m => m.x === targetX && m.y === targetY && m.hp > 0);
        if (targetMonster) {
            result.combatTriggered = true;
            result.combatReport = this.resolveDuel(this.player, targetMonster, true);
            this.cleanDeadMonsters();
            return result;
        }

        // Совершаем физический шаг игрока
        this.player.x = targetX;
        this.player.y = targetY;

        // Ход всех живых монстров на карте
        for (let m of this.monsters) {
            if (m.hp <= 0) continue;

            const distToPlayer = Math.hypot(this.player.x - m.x, this.player.y - m.y);
            const hiddenAggroRadius = 3.8; // Скрытый радиус агро

            // Если игрок вошел в скрытый радиус агро — монстр начинает преследование
            if (distToPlayer <= hiddenAggroRadius && m.state !== 'chasing') {
                m.state = 'chasing';
                result.events.push(`Монстр [${m.tier}] заметил вас и перешел к преследованию!`);
            }

            if (m.state === 'chasing') {
                // Если монстр вплотную к игроку — он атакует первым!
                if (distToPlayer <= 1.0) {
                    result.combatTriggered = true;
                    result.combatReport = this.resolveDuel(m, this.player, false);
                    this.cleanDeadMonsters();
                    return result; // Ход прерывается боевой фазой
                }

                // Преследование по алгоритму BFS
                const nextStep = getNextStepBFS(this.dungeon.grid, this.dungeon.W, this.dungeon.H, m.x, m.y, this.player.x, this.player.y);
                
                // Проверяем, не занята ли клетка другим монстром перед шагом
                const occupied = this.monsters.some(other => other !== m && other.hp > 0 && other.x === nextStep.x && other.y === nextStep.y);
                if (!occupied && !(nextStep.x === this.player.x && nextStep.y === this.player.y)) {
                    m.x = nextStep.x;
                    m.y = nextStep.y;
                }
            } else {
                // Выполнение стандартного поведения вне боя
                this.executeIdleAI(m);
            }
        }

        return result;
    }

    /**
     * Поведение монстров вне агро.
     */
    executeIdleAI(m) {
        if (m.state === 'wander' && this.rng.chance(0.3)) {
            const directions = [{x:1, y:0}, {x:-1, y:0}, {x:0, y:1}, {x:0, y:-1}];
            const d = this.rng.pick(directions);
            const tx = m.x + d.x, ty = m.y + d.y;
            const idx = ty * this.dungeon.W + tx;
            
            if (this.dungeon.grid[idx] === FLOOR) {
                const occupied = this.monsters.some(other => other.hp > 0 && other.x === tx && other.y === ty);
                if (!occupied) { m.x = tx; m.y = ty; }
            }
        } else if (m.state === 'patrol' && this.rng.chance(0.4)) {
            // Простейший патруль взад-вперед по X
            const tx = m.x + m.patrolDir;
            const idx = m.y * this.dungeon.W + tx;
            if (this.dungeon.grid[idx] === FLOOR) {
                m.x = tx;
            } else {
                m.patrolDir *= -1; // Меняем вектор патруля
            }
        }
    }

    /**
     * Поединок на кубиках (Armello + DOS2).
     * @param {Object} attacker - Сущность с правом первого удара.
     * @param {Object} defender - Защищающаяся сущность.
     * @param {boolean} playerIsAttacker - Флаг, инициирован ли бой игроком.
     */
    resolveDuel(attacker, defender, playerIsAttacker) {
        const report = {
            playerInitiated: playerIsAttacker,
            attackerTier: attacker.tier || "Игрок",
            defenderTier: defender.tier || "Игрок",
            logs: [],
            victory: false,
            defeat: false,
            lootDropped: null
        };

        report.logs.push(`СТАРТ БОЯ: ${playerIsAttacker ? 'Вы' : 'Монстр'} атакуете первым!`);

        // --- ХОД АТАКУЮЩЕГО ---
        const attRoll = this.rollDicePool(attacker.fight, report.logs, playerIsAttacker ? "Игрок" : "Монстр");
        this.applyDamage(attRoll, defender, report.logs);

        if (defender.hp <= 0) {
            report.logs.push(`${playerIsAttacker ? 'Монстр' : 'Вы'} повержен на месте!`);
            if (playerIsAttacker) {
                report.victory = true;
                report.lootDropped = this.generateLoot();
            } else {
                report.defeat = true;
            }
            return report;
        }

        // --- ХОД ЗАЩИЩАЮЩЕГОСЯ (Контратака в случае выживания) ---
        report.logs.push(`Выживший проводит контратаку!`);
        const defRoll = this.rollDicePool(defender.fight, report.logs, !playerIsAttacker ? "Игрок" : "Монстр");
        this.applyDamage(defRoll, attacker, report.logs);

        if (attacker.hp <= 0) {
            report.logs.push(`${playerIsAttacker ? 'Вы' : 'Монстр'} погибает от ответного удара!`);
            if (playerIsAttacker) {
                report.defeat = true;
            } else {
                report.victory = true;
                report.lootDropped = this.generateLoot();
            }
        }

        return report;
    }

    /**
     * Детерминированный взрывной бросок кубиков в стиле Armello.
     */
    rollDicePool(count, logArray, entityName) {
        const results = { swords: 0, shields: 0, magics: 0, barriers: 0, wylds: 0, misses: 0 };
        let rollCount = count;
        let rollsLog = [];

        for (let i = 0; i < rollCount; i++) {
            const roll = this.rng.int(1, 7); // 1-6
            if (roll === 1) {
                results.swords++;
                rollsLog.push("⚔️");
            } else if (roll === 2) {
                results.shields++;
                rollsLog.push("🛡️");
            } else if (roll === 3) {
                results.magics++;
                rollsLog.push("⚡");
            } else if (roll === 4) {
                results.barriers++;
                rollsLog.push("🔮");
            } else if (roll === 5) {
                results.wylds++;
                rollsLog.push("🌳 (ВЗРЫВ!)");
                rollCount++; // Древо взрывается: добавляем еще один случайный кубик в пул!
            } else {
                results.misses++;
                rollsLog.push("❌");
            }
        }

        logArray.push(`${entityName} бросает кубики: [ ${rollsLog.join(', ')} ]`);
        return results;
    }

    /**
     * Поглощение урона броней в стиле Divinity: Original Sin 2.
     */
    applyDamage(roll, target, logArray) {
        // Щиты восстанавливают броню прямо в бою
        if (roll.shields > 0) {
            target.pa = Math.min(target.maxPa, target.pa + roll.shields);
            logArray.push(`Физическая броня цели укреплена на +${roll.shields} (PA: ${target.pa}/${target.maxPa})`);
        }
        if (roll.barriers > 0) {
            target.ma = Math.min(target.maxMa, target.ma + roll.barriers);
            logArray.push(`Магическая броня цели укреплена на +${roll.barriers} (MA: ${target.ma}/${target.maxMa})`);
        }

        // 1. Расчет физического урона (Мечи бьют по Физической броне)
        if (roll.swords > 0) {
            let pDmg = roll.swords;
            if (target.pa > 0) {
                const absorbed = Math.min(target.pa, pDmg);
                target.pa -= absorbed;
                pDmg -= absorbed;
                logArray.push(`Физическая броня поглотила ${absorbed} ед. урона (PA: ${target.pa})`);
            }
            if (pDmg > 0) {
                target.hp -= pDmg;
                logArray.push(`Пробитие! Нанесено ${pDmg} физ. урона по здоровью (HP: ${target.hp})`);
            }
        }

        // 2. Расчет магического урона (Магические вспышки бьют по Магической броне)
        if (roll.magics > 0) {
            let mDmg = roll.magics;
            if (target.ma > 0) {
                const absorbed = Math.min(target.ma, mDmg);
                target.ma -= absorbed;
                mDmg -= absorbed;
                logArray.push(`Магическая броня поглотила ${absorbed} ед. урона (MA: ${target.ma})`);
            }
            if (mDmg > 0) {
                target.hp -= mDmg;
                logArray.push(`Пробитие! Нанесено ${mDmg} маг. урона по здоровью (HP: ${target.hp})`);
            }
        }
    }

    /**
     * Генерация роглайт добычи после успешного боя.
     */
    generateLoot() {
        const roll = this.rng.next();
        if (roll < 0.4) {
            // 40% шанс выпадения боевой карты
            return { type: 'card', name: this.rng.pick(['Удар', 'Блок', 'Свиток искр', 'Зелье удачи']) };
        } else if (roll < 0.6) {
            // 20% шанс выпадения экипировки
            return {
                type: 'equipment',
                slot: this.rng.pick(['weapon', 'armor']),
                name: this.rng.pick(['Стальной палаш', 'Кожаная куртка', 'Амулет силы'])
            };
        }
        return null; // Ничего не выпало
    }

    /**
     * Очистка списка монстров от павших.
     */
    cleanDeadMonsters() {
        // Павшие монстры остаются лежать на клетке, но исключаются из обработки коллизий
        this.monsters = this.monsters.filter(m => m.hp > 0);
    }
}

/**
 * Класс-декоратор для безопасного копирования SeededRNG в combat.js.
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
    int(a, b) {
        return Math.floor(a + this.next() * (b - a));
    }
    pick(arr) {
        return arr[Math.floor(this.next() * arr.length)];
    }
    chance(p) {
        return this.next() < p;
    }
}
