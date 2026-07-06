import { PRNG } from './prng.js';
import { MapGenerator } from './mapGenerator.js';
import { SceneBuilder } from './sceneBuilder.js';
import { FogOfWar } from './fogOfWar.js';
import { CombatSystem } from './combatSystem.js';
import { AIController } from './aiController.js';

class Game {
    constructor() {
        this.prng = new PRNG("roguelike_seed");
        this.sceneBuilder = new SceneBuilder(document.getElementById("canvas-container"));
        
        this.player = {
            x: 0, y: 0,
            dir: { x: 1, y: 0 },
            stats: {
                maxHp: 30, hp: 30,
                maxPa: 6, pa: 6,
                maxMa: 6, ma: 6,
                fight: 5
            },
            mesh: null
        };

        this.monsters = [];
        this.monsterMeshes = {}; 
        this.chests = [];
        this.portal = { x: 0, y: 0 };
        this.grid = null;
        this.fog = null;
        this.ai = null;
        this.combat = null;

        this.state = "EXPLORATION"; 
        this.level = 1;

        this.cameraZoomTarget = 15;
        this.cameraZoomCurrent = 15;

        this.init();
    }

    init() {
        this.setupPlayerMesh();
        this.generateNewLevel();
        this.setupInput();
        this.updateHUD();

        this.clock = new THREE.Clock();
        this.animate();
    }

    setupPlayerMesh() {
        const playerGroup = new THREE.Group();
        const bodyGeo = new THREE.CylinderGeometry(0.3, 0.3, 1, 8);
        const bodyMat = new THREE.MeshPhongMaterial({ color: 0x44aaee, shininess: 30 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 0.5;
        playerGroup.add(body);

        const headGeo = new THREE.SphereGeometry(0.15, 8, 8);
        const headMat = new THREE.MeshPhongMaterial({ color: 0xffffff });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.set(0, 0.8, 0.2);
        playerGroup.add(head);

        this.player.mesh = playerGroup;
    }

    generateNewLevel() {
        this.log("Генерация подземелья, уровень " + this.level + "...");
        
        const mapGen = new MapGenerator(30, 30, this.prng);
        const mapData = mapGen.generate();
        
        this.grid = mapData.grid;
        this.chests = mapData.chests;
        this.portal = mapData.portal;
        this.monsters = mapData.monsters;

        Object.values(this.monsterMeshes).forEach(mesh => {
            this.sceneBuilder.scene.remove(mesh);
        });
        this.monsterMeshes = {};

        this.sceneBuilder.buildDungeon(mapData, this.prng);
        
        this.player.x = mapData.playerSpawn.x;
        this.player.y = mapData.playerSpawn.y;
        this.player.dir = { x: 0, y: 1 };
        this.player.mesh.position.set(this.player.x, 0, this.player.y);
        this.sceneBuilder.scene.add(this.player.mesh);

        this.monsters.forEach(m => {
            const monsterMesh = this.createMonsterMesh(m.aiType);
            monsterMesh.position.set(m.x, 0, m.y);
            this.sceneBuilder.scene.add(monsterMesh);
            this.monsterMeshes[m.id] = monsterMesh;
        });

        this.ai = new AIController(this.grid, this.prng);
        this.fog = new FogOfWar(this.grid, this.sceneBuilder);

        this.fog.updateFOV(this.player.x, this.player.y, this.player.dir.x, this.player.dir.y);

        this.state = "EXPLORATION";
        this.cameraZoomTarget = this.sceneBuilder.currentFrustumSize || 15;
        this.cameraZoomCurrent = this.cameraZoomTarget;

        this.log("Уровень готов. Используйте WASD/Стрелки или D-Pad для ходьбы.");
    }

    createMonsterMesh(aiType) {
        const group = new THREE.Group();
        const baseGeo = new THREE.ConeGeometry(0.3, 0.9, 8);
        
        let color = 0xee4444; 
        if (aiType === "Patrol") color = 0xee9944; 
        else if (aiType === "Wander") color = 0xeeee44; 

        const baseMat = new THREE.MeshPhongMaterial({ color, shininess: 20 });
        const cone = new THREE.Mesh(baseGeo, baseMat);
        cone.position.y = 0.45;
        group.add(cone);

        return group;
    }

    setupInput() {
        window.addEventListener("keydown", (e) => {
            if (this.state !== "EXPLORATION") return;

            let dx = 0;
            let dy = 0;

            if (e.key === "w" || e.key === "ArrowUp") { dy = -1; }
            else if (e.key === "s" || e.key === "ArrowDown") { dy = 1; }
            else if (e.key === "a" || e.key === "ArrowLeft") { dx = -1; }
            else if (e.key === "d" || e.key === "ArrowRight") { dx = 1; }

            if (dx !== 0 || dy !== 0) {
                e.preventDefault();
                this.executeTurn(dx, dy);
            }
        });

        const bindButton = (id, dx, dy) => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.addEventListener("click", () => {
                    if (this.state === "EXPLORATION") {
                        this.executeTurn(dx, dy);
                    }
                });
            }
        };

        bindButton("pad-up", 0, -1);
        bindButton("pad-down", 0, 1);
        bindButton("pad-left", -1, 0);
        bindButton("pad-right", 1, 0);

        const regBtn = document.getElementById("regen-btn");
        if (regBtn) {
            regBtn.addEventListener("click", () => {
                const seedInput = document.getElementById("seed-input");
                if (seedInput) {
                    this.prng.reseed(seedInput.value);
                }
                this.generateNewLevel();
            });
        }
    }

    executeTurn(dx, dy) {
        this.player.dir = { x: dx, y: dy };
        
        const angle = Math.atan2(dx, dy);
        this.player.mesh.rotation.y = angle;

        const tx = this.player.x + dx;
        const ty = this.player.y + dy;

        if (this.grid[ty] && this.grid[ty][tx] === 1) { 
            const metMonster = this.monsters.find(m => m.x === tx && m.y === ty);
            if (metMonster) {
                this.startCombat(metMonster, true);
                return;
            }

            this.player.x = tx;
            this.player.y = ty;
            this.player.mesh.position.set(tx, 0, ty);

            const chestIdx = this.chests.findIndex(c => c.x === tx && c.y === ty);
            if (chestIdx !== -1) {
                this.log("Вы открыли сундук и восстановили броню!");
                this.player.stats.pa = this.player.stats.maxPa;
                this.player.stats.ma = this.player.stats.maxMa;
                this.chests.splice(chestIdx, 1);
                this.sceneBuilder.setTileVisibility(tx, ty, false, 'chest');
            }

            if (this.portal.x === tx && this.portal.y === ty) {
                this.log("Портал! Переход на следующий уровень...");
                this.level++;
                this.generateNewLevel();
                return;
            }
        } else {
            this.log("Путь заблокирован.");
        }

        this.updateMonstersTurn();
        this.fog.updateFOV(this.player.x, this.player.y, this.player.dir.x, this.player.dir.y);
        this.updateHUD();
    }

    updateMonstersTurn() {
        this.monsters.forEach(m => {
            if (m.stats.hp <= 0) return;

            const nextStep = this.ai.computeNextMove(m, this.player.x, this.player.y, this.monsters);
            
            if (nextStep.x === this.player.x && nextStep.y === this.player.y) {
                this.startCombat(m, false);
                return;
            }

            m.x = nextStep.x;
            m.y = nextStep.y;

            const mesh = this.monsterMeshes[m.id];
            if (mesh) {
                mesh.position.set(m.x, 0, m.y);
                const isVis = this.fog.isCellVisible(m.x, m.y);
                mesh.scale.setScalar(isVis ? 1 : 0);
            }
        });
    }

    startCombat(monster, playerInitiative) {
        this.state = "COMBAT";
        this.cameraZoomTarget = 6.5; // Наезд камерой при старте боя

        const overlay = document.getElementById("combat-overlay");
        overlay.classList.add("active");

        this.combat = new CombatSystem(
            this.player,
            monster,
            this.prng,
            () => this.renderCombatUI(),
            (victory) => this.endCombat(victory)
        );

        if (playerInitiative) {
            this.combat.log("Ваша инициатива: вы атаковали первыми!");
        } else {
            this.combat.log("Засада! Монстр застал вас врасплох!");
            this.combat.applyDamage(this.player.combat, 2, 0);
        }

        this.combat.onUpdate();
    }

    renderCombatUI() {
        if (!this.combat) return;

        document.getElementById("combat-p-hp").textContent = this.combat.player.combat.hp;
        document.getElementById("combat-p-pa").textContent = this.combat.player.combat.pa;
        document.getElementById("combat-p-ma").textContent = this.combat.player.combat.ma;
        document.getElementById("combat-p-fight").textContent = this.combat.player.combat.fight;

        document.getElementById("combat-m-name").textContent = `${this.combat.monster.aiType} Монстр`;
        document.getElementById("combat-m-hp").textContent = this.combat.monster.stats.hp;
        document.getElementById("combat-m-pa").textContent = this.combat.monster.stats.pa;
        document.getElementById("combat-m-ma").textContent = this.combat.monster.stats.ma;

        const cardsHand = document.getElementById("cards-hand");
        cardsHand.innerHTML = "";
        
        this.combat.hand.forEach(card => {
            const el = document.createElement("div");
            el.className = "card";
            el.innerHTML = `
                <div class="card-name">${card.name}</div>
                <div class="card-desc">${card.desc}</div>
                <div class="card-actions">
                    <button class="card-btn play-btn">Разыграть</button>
                    <button class="card-btn burn-btn">Сжечь</button>
                </div>
            `;
            el.querySelector(".play-btn").addEventListener("click", () => {
                this.combat.playCard(card.uid);
            });
            el.querySelector(".burn-btn").addEventListener("click", () => {
                this.combat.burnCard(card.uid);
            });

            cardsHand.appendChild(el);
        });

        const logBox = document.getElementById("combat-logs");
        logBox.innerHTML = this.combat.combatLog.map(l => `<div>${l}</div>`).join('');

        const burnLabel = document.getElementById("burn-status");
        if (this.combat.activeBurn) {
            burnLabel.textContent = `Сжигание: ${this.combat.activeBurn.name} (Куб: ${this.combat.activeBurn.burnFace})`;
        } else {
            burnLabel.textContent = "";
        }
    }

    endCombat(victory) {
        const overlay = document.getElementById("combat-overlay");
        overlay.classList.remove("active");

        if (victory) {
            this.log("Монстр побежден!");
            
            const index = this.monsters.findIndex(m => m.id === this.combat.monster.id);
            if (index !== -1) {
                const m = this.monsters[index];
                const mesh = this.monsterMeshes[m.id];
                if (mesh) {
                    this.sceneBuilder.scene.remove(mesh);
                    delete this.monsterMeshes[m.id];
                }
                this.monsters.splice(index, 1);
            }
            
            this.state = "EXPLORATION";
            this.cameraZoomTarget = this.sceneBuilder.currentFrustumSize || 15;
            this.fog.updateFOV(this.player.x, this.player.y, this.player.dir.x, this.player.dir.y);
        } else {
            this.state = "GAME_OVER";
            this.log("Вы погибли.");
            alert("Игра окончена! Ваши кости пополнят коллекцию этого подземелья.");
        }

        this.combat = null;
        this.updateHUD();
    }

    updateHUD() {
        document.getElementById("p-hp").textContent = this.player.stats.hp;
        document.getElementById("p-pa").textContent = this.player.stats.pa;
        document.getElementById("p-ma").textContent = this.player.stats.ma;
        document.getElementById("hud-level").textContent = this.level;
    }

    log(msg) {
        const el = document.getElementById("game-log");
        if (el) {
            el.innerHTML += `<div>[Уровень ${this.level}] ${msg}</div>`;
            el.scrollTop = el.scrollHeight;
        }
    }

    animate() {
        requestAnimationFrame(this.animate.bind(this));

        const dt = this.clock.getDelta();

        // Сглаживание зума камеры во время изменения Frustum Size
        if (Math.abs(this.cameraZoomCurrent - this.cameraZoomTarget) > 0.05) {
            this.cameraZoomCurrent += (this.cameraZoomTarget - this.cameraZoomCurrent) * 5 * dt;
            this.sceneBuilder.currentFrustumSize = this.cameraZoomCurrent;
            this.sceneBuilder.onResize(); 
        }

        // Камера следует за активными элементами сцены
        if (this.state === "EXPLORATION") {
            const targetPos = new THREE.Vector3(this.player.x + 12, 12, this.player.y + 12);
            this.sceneBuilder.camera.position.lerp(targetPos, 4 * dt);
            this.sceneBuilder.controls.target.lerp(new THREE.Vector3(this.player.x, 0.1, this.player.y), 4 * dt);
        } else if (this.state === "COMBAT" && this.combat) {
            // Центрирование камеры между игроком и монстром
            const avgX = (this.player.x + this.combat.monster.x) / 2;
            const avgY = (this.player.y + this.combat.monster.y) / 2;
            const targetCenter = new THREE.Vector3(avgX, 0.1, avgY);
            this.sceneBuilder.controls.target.lerp(targetCenter, 4 * dt);

            const zoomCamPos = new THREE.Vector3(avgX + 6, 6, avgY + 6);
            this.sceneBuilder.camera.position.lerp(zoomCamPos, 4 * dt);
        }

        this.sceneBuilder.controls.update();
        this.sceneBuilder.updateAnimation(dt);
        this.sceneBuilder.renderer.render(this.sceneBuilder.scene, this.sceneBuilder.camera);
    }
}

document.getElementById("roll-dice-btn").addEventListener("click", () => {
    if (window.gameInstance && window.gameInstance.combat) {
        window.gameInstance.combat.executeRound();
    }
});

window.addEventListener("DOMContentLoaded", () => {
    window.gameInstance = new Game();
});
