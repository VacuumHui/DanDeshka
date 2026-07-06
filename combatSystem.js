export class CombatSystem {
    constructor(player, monster, prng, onUpdate, onFinished) {
        this.player = player;
        this.monster = monster;
        this.prng = prng;
        this.onUpdate = onUpdate;
        this.onFinished = onFinished;

        this.combatLog = [];
        this.hand = [];
        this.activeBurn = null;

        this.initDuel();
    }

    initDuel() {
        this.log("НАЧАЛАСЬ СМЕРТЕЛЬНАЯ БИТВА!");
        this.player.combat = {
            maxHp: this.player.stats.maxHp,
            hp: this.player.stats.hp,
            maxPa: this.player.stats.maxPa,
            pa: this.player.stats.pa,
            maxMa: this.player.stats.maxMa,
            ma: this.player.stats.ma,
            fight: this.player.stats.fight
        };

        this.drawCards();
        this.onUpdate();
    }

    drawCards() {
        const cardPool = [
            { id: "c1", name: "Heavy Shield", type: "Def", desc: "Сыграть: +3 PA. Сжечь: 🛡️", burnFace: "🛡️" },
            { id: "c2", name: "Sharp Edge", type: "Atk", desc: "Сыграть: +2 Физ. Сжечь: ⚔️", burnFace: "⚔️" },
            { id: "c3", name: "Wizard Ward", type: "Def", desc: "Сыграть: +3 MA. Сжечь: 🔮", burnFace: "🔮" },
            { id: "c4", name: "Lightning Bolt", type: "Atk", desc: "Сыграть: +2 Маг. Сжечь: ⚡", burnFace: "⚡" },
            { id: "c5", name: "Life Sap", type: "Util", desc: "Сыграть: +2 HP. Сжечь: 🌳", burnFace: "🌳" }
        ];

        while (this.hand.length < 5) {
            const card = this.prng.choose(cardPool);
            this.hand.push({ ...card, uid: `card_${Math.floor(this.prng.next() * 1000000)}` });
        }
    }

    log(msg) {
        this.combatLog.unshift(msg);
        if (this.combatLog.length > 8) this.combatLog.pop();
    }

    playCard(cardUid) {
        const index = this.hand.findIndex(c => c.uid === cardUid);
        if (index === -1) return;

        const card = this.hand[index];
        this.hand.splice(index, 1);

        if (card.name === "Heavy Shield") {
            this.player.combat.pa = Math.min(this.player.combat.maxPa, this.player.combat.pa + 3);
            this.log(`Сыграно Тяжелый Щит: +3 PA (PA: ${this.player.combat.pa})`);
        } else if (card.name === "Sharp Edge") {
            this.log("Сыграно Острое Лезвие: 2 прямого физ. урона!");
            this.applyDamage(this.monster.stats, 2, 0);
        } else if (card.name === "Wizard Ward") {
            this.player.combat.ma = Math.min(this.player.combat.maxMa, this.player.combat.ma + 3);
            this.log(`Сыграно Оберег: +3 MA (MA: ${this.player.combat.ma})`);
        } else if (card.name === "Lightning Bolt") {
            this.log("Сыграно Молния: 2 прямого маг. урона!");
            this.applyDamage(this.monster.stats, 0, 2);
        } else if (card.name === "Life Sap") {
            this.player.combat.hp = Math.min(this.player.combat.maxHp, this.player.combat.hp + 2);
            this.log(`Сыграно Похищение Жизни: +2 HP (HP: ${this.player.combat.hp})`);
        }

        this.checkCombatStatus();
        this.onUpdate();
    }

    burnCard(cardUid) {
        const index = this.hand.findIndex(c => c.uid === cardUid);
        if (index === -1) return;

        this.activeBurn = this.hand[index];
        this.hand.splice(index, 1);
        this.log(`Сожжено: ${this.activeBurn.name}. Следующий бросок гарантирует 1 грань ${this.activeBurn.burnFace}!`);
        this.onUpdate();
    }

    executeRound() {
        this.log("--- СТОЛКНОВЕНИЕ КУБИКОВ ---");

        let pRolls = this.rollDicePool(this.player.combat.fight, this.activeBurn ? this.activeBurn.burnFace : null);
        this.activeBurn = null; 

        let mRolls = this.rollDicePool(this.monster.stats.fight, null);

        this.log(`Кубы героя: [ ${pRolls.join(' ')} ]`);
        this.log(`Кубы монстра: [ ${mRolls.join(' ')} ]`);

        let pPhysDmg = 0;
        let pMagDmg = 0;
        pRolls.forEach(face => {
            if (face === "⚔️") pPhysDmg++;
            else if (face === "⚡") pMagDmg++;
            else if (face === "🛡️") {
                this.player.combat.pa = this.player.combat.maxPa;
                this.log("Герой восстановил физ. броню!");
            } else if (face === "🔮") {
                this.player.combat.ma = this.player.combat.maxMa;
                this.log("Герой восстановил маг. броню!");
            } else if (face === "🌳") {
                pPhysDmg++; 
            }
        });

        let mPhysDmg = 0;
        let mMagDmg = 0;
        mRolls.forEach(face => {
            if (face === "⚔️") mPhysDmg++;
            else if (face === "⚡") mMagDmg++;
            else if (face === "🛡️") {
                this.monster.stats.pa = this.monster.stats.maxPa;
                this.log("Монстр восстановил физ. броню!");
            } else if (face === "🔮") {
                this.monster.stats.ma = this.monster.stats.maxMa;
                this.log("Монстр восстановил маг. броню!");
            } else if (face === "🌳") {
                mPhysDmg++;
            }
        });

        // Поглощение урона броней по системе Divinity: Original Sin 2
        if (pPhysDmg > 0 || pMagDmg > 0) {
            this.log(`Вы наносите: ${pPhysDmg} физ. ⚔️, ${pMagDmg} маг. ⚡`);
            this.applyDamage(this.monster.stats, pPhysDmg, pMagDmg);
        }
        if (mPhysDmg > 0 || mMagDmg > 0) {
            this.log(`Монстр наносит: ${mPhysDmg} физ. ⚔️, ${mMagDmg} маг. ⚡`);
            this.applyDamage(this.player.combat, mPhysDmg, mMagDmg);
        }

        this.drawCards();
        this.checkCombatStatus();
        this.onUpdate();
    }

    rollDicePool(count, guaranteedFace = null) {
        const faces = ["⚔️", "🛡️", "⚡", "🔮", "🌳", "❌"];
        const results = [];
        let index = 0;

        if (guaranteedFace) {
            results.push(guaranteedFace);
            index = 1;
            // Взрывной бросок (Древо): засчитывается как 1 физ. урон + бросок доп. кубика в пул
            if (guaranteedFace === "🌳") {
                count++;
            }
        }

        for (; index < count; index++) {
            const rolled = this.prng.choose(faces);
            results.push(rolled);
            if (rolled === "🌳") {
                count++; 
            }
        }
        return results;
    }

    applyDamage(target, phys, magic) {
        if (phys > 0) {
            if (target.pa >= phys) {
                target.pa -= phys;
            } else {
                const remainder = phys - target.pa;
                target.pa = 0;
                target.hp = Math.max(0, target.hp - remainder);
            }
        }

        if (magic > 0) {
            if (target.ma >= magic) {
                target.ma -= magic;
            } else {
                const remainder = magic - target.ma;
                target.ma = 0;
                target.hp = Math.max(0, target.hp - remainder);
            }
        }
    }

    checkCombatStatus() {
        if (this.monster.stats.hp <= 0) {
            this.log("ПОБЕДА! Монстр повержен.");
            this.player.stats.hp = this.player.combat.hp;
            this.player.stats.pa = this.player.combat.pa;
            this.player.stats.ma = this.player.combat.ma;
            
            setTimeout(() => this.onFinished(true), 1200);
        } else if (this.player.combat.hp <= 0) {
            this.log("ВЫ ПАЛИ В БОЮ...");
            this.player.stats.hp = 0;
            
            setTimeout(() => this.onFinished(false), 1200);
        }
    }
}
