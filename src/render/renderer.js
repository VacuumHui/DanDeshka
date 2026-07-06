import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Класс управления 3D рендерингом, камерой и динамическим фокусом.
 */
export class DungeonRenderer {
    /**
     * @param {HTMLElement} container - DOM-элемент для монтирования Canvas.
     */
    constructor(container) {
        this.container = container;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.hLight = null;
        this.dLight = null;

        // Состояние интерполяции камеры (плавный зум / наведение во время боя)
        this.cameraTransition = {
            active: false,
            elapsed: 0,
            duration: 1.0,
            
            // Стартовые параметры
            startTarget: new THREE.Vector3(),
            startFrustum: 18,
            
            // Целевые параметры
            endTarget: new THREE.Vector3(),
            endFrustum: 18
        };
    }

    /**
     * Инициализация WebGL2 рендерера, сцены, камеры и OrbitControls.
     */
    init() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x06070a);

        // Инициализируем линейный туман по умолчанию
        this.scene.fog = new THREE.Fog(0x06070a, 10, 100);

        const aspect = window.innerWidth / window.innerHeight;
        const d = 18;
        this.camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 1, 2000);
        this.camera.userData.frustumSize = d;

        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxPolarAngle = Math.PI * 0.45; // Ограничение взгляда за горизонт

        this.setupLights();
        this.setupResizeListener();
    }

    /**
     * Создание освещения.
     */
    setupLights() {
        // Холодный заполняющий свет полусферы
        this.hLight = new THREE.HemisphereLight(0x3b82f6, 0x111827, 1.2);
        this.scene.add(this.hLight);

        // Теплый направленный свет для подчеркивания лоу-поли рельефа
        this.dLight = new THREE.DirectionalLight(0xffffff, 0.8);
        this.dLight.position.set(40, 50, 30);
        this.scene.add(this.dLight);
    }

    /**
     * Динамическое масштабирование и позиционирование под размер сгенерированного подземелья.
     * @param {Object} dungeon - Данные сгенерированного подземелья.
     */
    fitCamera(dungeon) {
        const aspect = window.innerWidth / window.innerHeight;
        const mapSize = Math.max(dungeon.W, dungeon.H);
        let frustumSize = mapSize * 0.65; // Базовое комфортное заполнение экрана

        // Адаптация под мобильные вертикальные экраны (расширяем область видимости по горизонтали)
        if (aspect < 1.0) {
            frustumSize = frustumSize / aspect;
        }

        this.camera.userData.frustumSize = frustumSize;
        this.camera.left = -frustumSize * aspect;
        this.camera.right = frustumSize * aspect;
        this.camera.top = frustumSize;
        this.camera.bottom = -frustumSize;
        this.camera.updateProjectionMatrix();

        // Позиционируем камеру на безопасное расстояние без обрезания плоскостями (Isometric offset)
        const offset = mapSize * 0.8;
        this.camera.position.set(
            dungeon.W * 0.5 + offset,
            offset * Math.tan(35.264 * Math.PI / 180),
            dungeon.W * 0.5 + offset
        );

        this.controls.target.set(dungeon.W * 0.5, 0, dungeon.H * 0.5);
        this.controls.update();

        // Настройка линейного тумана под радиус подземелья
        if (this.scene.fog) {
            const mapRadius = Math.hypot(dungeon.W, dungeon.H) * 0.5;
            this.scene.fog.near = mapRadius * 0.4;
            this.scene.fog.far = mapRadius * 3.5;
        }
    }

    /**
     * Запуск плавного перемещения/зума камеры к определенной точке.
     * @param {THREE.Vector3} target - Координаты фокуса (world space).
     * @param {number} frustumSize - Целевое приближение (масштаб).
     * @param {number} duration - Длительность анимации в секундах.
     */
    triggerCameraTransition(target, frustumSize, duration = 1.0) {
        this.cameraTransition.startTarget.copy(this.controls.target);
        this.cameraTransition.startFrustum = this.camera.userData.frustumSize;

        this.cameraTransition.endTarget.copy(target);
        this.cameraTransition.endFrustum = frustumSize;

        this.cameraTransition.duration = duration;
        this.cameraTransition.elapsed = 0;
        this.cameraTransition.active = true;
    }

    /**
     * Обновление матриц рендеринга и расчет интерполяций камеры за кадр.
     * @param {number} dt - Дельта времени в секундах.
     */
    update(dt) {
        // Обработка плавной анимации наезда/отката камеры
        if (this.cameraTransition.active) {
            this.cameraTransition.elapsed += dt;
            const progress = Math.min(this.cameraTransition.elapsed / this.cameraTransition.duration, 1.0);
            
            // Функция сглаживания (Ease-In-Out)
            const ease = progress < 0.5 
                ? 2 * progress * progress 
                : 1 - Math.pow(-2 * progress + 2, 2) / 2;

            // Интерполяция фокуса OrbitControls
            this.controls.target.lerpVectors(
                this.cameraTransition.startTarget,
                this.cameraTransition.endTarget,
                ease
            );

            // Интерполяция масштаба FrustumSize
            const currentFrustum = THREE.MathUtils.lerp(
                this.cameraTransition.startFrustum,
                this.cameraTransition.endFrustum,
                ease
            );

            this.camera.userData.frustumSize = currentFrustum;
            const aspect = window.innerWidth / window.innerHeight;
            this.camera.left = -currentFrustum * aspect;
            this.camera.right = currentFrustum * aspect;
            this.camera.top = currentFrustum;
            this.camera.bottom = -currentFrustum;
            this.camera.updateProjectionMatrix();

            if (progress >= 1.0) {
                this.cameraTransition.active = false;
            }
        }

        // Обновление трекинга OrbitControls
        this.controls.update();

        // Отрисовка сцены
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    /**
     * Слушатель событий изменения размеров окна браузера.
     */
    setupResizeListener() {
        window.addEventListener('resize', () => {
            if (!this.camera || !this.renderer) return;
            const aspect = window.innerWidth / window.innerHeight;
            const fSize = this.camera.userData.frustumSize;
            
            this.camera.left = -fSize * aspect;
            this.camera.right = fSize * aspect;
            this.camera.top = fSize;
            this.camera.bottom = -fSize;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    /**
     * Очистка сцены для предотвращения утечек видеопамяти при регенерации.
     */
    clearScene() {
        // Удаление всех групп и мешей, кроме света
        const toRemove = [];
        this.scene.traverse((child) => {
            if (child !== this.scene && child !== this.hLight && child !== this.dLight) {
                toRemove.push(child);
            }
        });
        
        for (let obj of toRemove) {
            this.scene.remove(obj);
        }
    }
}
