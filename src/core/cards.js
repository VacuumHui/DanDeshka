/**
 * База данных игровых карт (ブルーпринты).
 * Каждая карта имеет название, описание, целевую грань кубика для сжигания (Burn)
 * и функциональный эффект при разыгрывании (Play) [INDEX].
 */
export const CARD_DATABASE = {
    'Удар': {
        name: 'Удар',
        burnFace: 'swords', // Сжигание дает гарантированный меч ⚔️
        description: 'Наносит 2 ед. физического урона врагу.',
        play: (combatSystem, target) => {
            target.hp -= 2;
        }
    },
    'Блок': {
        name: 'Блок',
        burnFace: 'shields', // Сжигание дает гарантированный щит 🛡️
        description: 'Восстанавливает +3 ед. физической брони.',
        play: (combatSystem, target) => {
            target.pa = Math.min(target.maxPa, target.pa + 3);
        }
    },
    'Свиток искр': {
        name: 'Свиток искр',
        burnFace: 'magics', // Сжигание дает гарантированную вспышку ⚡
        description: 'Наносит 2 ед. магического урона врагу.',
        play: (combatSystem, target) => {
            target.hp -= 2;
        }
    },
    'Зелье удачи': {
        name: 'Зелье удачи',
        burnFace: 'wylds', // Сжигание дает гарантированное Древо 🌳
        description: 'Временно добавляет +1 кубик к следующему броску боя.',
        play: (combatSystem, target) => {
            target.fight += 1;
        }
    }
};

/**
 * Класс менеджера руки карт персонажа.
 */
export class CardManager {
    /**
     * @param {Object} player - Объект игрока.
     * @param {number} limit - Ограничение на максимальное количество карт в руке (по умолчанию 5) [INDEX].
     */
    constructor(player, limit = 5) {
        this.player = player;
        this.limit = limit;
    }

    /**
     * Добавление новой карты в инвентарь игрока (с проверкой переполнения руки) [INDEX].
     * @param {string} cardName - Название карты.
     * @returns {boolean} true, если карта успешно добавлена.
     */
    addCard(cardName) {
        if (this.player.cards.length < this.limit) {
            this.player.cards.push(cardName);
            return true;
        }
        return false; // Превышен лимит руки
    }

    /**
     * Разыгрывание карты из инвентаря на выбранную цель.
     * @param {number} index - Индекс карты в руке.
     * @param {Object} combatSystem - Ссылка на боевую систему для логов.
     * @param {Object} target - Целевой юнит (монстр или сам игрок).
     * @returns {boolean} true, если карта разыграна успешно.
     */
    playCard(index, combatSystem, target) {
        if (index < 0 || index >= this.player.cards.length) return false;

        const cardName = this.player.cards[index];
        const card = CARD_DATABASE[cardName];

        if (card) {
            card.play(combatSystem, target);
            this.player.cards.splice(index, 1); // Карта расходуется из руки [INDEX]
            return true;
        }
        return false;
    }

    /**
     * Сжигание карты для фиксации конкретной грани кубика.
     * @param {number} index - Индекс карты в руке.
     * @returns {string|null} Название грани (swords, shields, magics, barriers), если успешно.
     */
    burnCard(index) {
        if (index < 0 || index >= this.player.cards.length) return null;

        const cardName = this.player.cards[index];
        const card = CARD_DATABASE[cardName];

        if (card) {
            this.player.cards.splice(index, 1); // Карта расходуется из руки
            return card.burnFace;
        }
        return null;
    }
}
