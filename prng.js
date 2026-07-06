// Детерминированный генератор псевдослучайных чисел на основе алгоритма Mulberry32
export class PRNG {
    constructor(seedStr = "roguelike") {
        this.reseed(seedStr);
    }

    reseed(seedStr) {
        let h = 2166136261 >>> 0;
        for (let i = 0; i < seedStr.length; i++) {
            h = Math.imul(h ^ seedStr.charCodeAt(i), 16777619);
        }
        this.state = h >>> 0;
    }

    next() {
        let t = this.state += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    range(min, max) {
        return min + this.next() * (max - min);
    }

    rangeInt(min, max) {
        return Math.floor(this.range(min, max));
    }

    choose(array) {
        if (!array || array.length === 0) return null;
        return array[this.rangeInt(0, array.length)];
    }
}
