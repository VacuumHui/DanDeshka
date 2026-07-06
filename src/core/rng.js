/**
 * Класс детерминированного генератора случайных чисел на основе Mulberry32.
 */
export class SeededRNG {
    /**
     * @param {number} seed - Стартовое число-зерно (сид) генератора.
     */
    constructor(seed) {
        this.state = seed >>> 0;
    }

    /**
     * Генерирует псевдослучайное число с плавающей запятой в диапазоне [0, 1).
     * @returns {number}
     */
    next() {
        let t = this.state += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /**
     * Генерирует число в диапазоне [a, b).
     * @param {number} a
     * @param {number} b
     * @returns {number}
     */
    float(a, b) {
        return a + this.next() * (b - a);
    }

    /**
     * Генерирует целое число в диапазоне [a, b) (исключая b).
     * @param {number} a
     * @param {number} b
     * @returns {number}
     */
    int(a, b) {
        return Math.floor(this.float(a, b));
    }

    /**
     * Случайным образом выбирает элемент из массива.
     * @param {Array} arr
     * @returns {*}
     */
    pick(arr) {
        return arr[Math.floor(this.next() * arr.length)];
    }

    /**
     * Возвращает true с вероятностью p (от 0 до 1).
     * @param {number} p
     * @returns {boolean}
     */
    chance(p) {
        return this.next() < p;
    }

    /**
     * Генерирует нормальное (гауссово) распределение методом Бокса-Мюллера.
     * @param {number} mu - Математическое ожидание (среднее).
     * @param {number} sigma - Среднеквадратичное отклонение.
     * @returns {number}
     */
    gaussian(mu, sigma) {
        let u = 0, v = 0;
        while (u === 0) u = this.next();
        while (v === 0) v = this.next();
        let num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
        return num * sigma + mu;
    }
}

/**
 * Хелпер для преобразования строкового сида в числовой хэш.
 * @param {string|number} val
 * @returns {number}
 */
export function getSeedHash(val) {
    if (!isNaN(val) && !isNaN(parseFloat(val))) {
        return parseInt(val) >>> 0;
    }
    let hash = 0;
    const str = String(val);
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
    }
    return hash >>> 0;
}
