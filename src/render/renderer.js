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

        this.cameraTransition = {
            active: false,
            elapsed: 0,
            duration: 1.0,
            startTarget: new THREE.Vector3(),
            startFrustum: 18,
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

        // Линейный туман по умолчанию
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
        this.controls.maxPolarAngle = Math.PI * 0.45;

        this.setupLights();
        this.setupResizeListener();
    }

    setupLights() {
        this.hLight = new THREE.HemisphereLight(0x3b82f6, 0x111827, 1.2);
        this.scene.add(this.hLight);

        this.dLight = new THREE.DirectionalLight(0xffffff, 0.8);
        this.dLight.position.set(40, 50, 30);
        this.scene.add(this.dLight);
    }

    fitCamera(dungeon) {
        const aspect = window.innerWidth / window.innerHeight;
        const mapSize = Math.max(dungeon.W, dungeon.H);
        let frustumSize = mapSize * 0.65;

        if (aspect < 1.0) {
            frustumSize = frustumSize / aspect;
        }

        this.camera.userData.frustumSize = frustumSize;
        this.camera.left = -frustumSize * aspect;
        this.camera.right = frustumSize * aspect;
        this.camera.top = frustumSize;
        this.camera.bottom = -frustumSize;
        this.camera.updateProjectionMatrix();

        const offset = mapSize * 0.8;
        this.camera.position.set(
            dungeon.W * 0.5 + offset,
            offset * Math.tan(35.264 * Math.PI / 180),
            dungeon.W * 0.5 + offset
        );

        this.controls.target.set(dungeon.W * 0.5, 0, dungeon.H * 0.5);
        this.controls.update();

        if (this.scene.fog) {
            const mapRadius = Math.hypot(dungeon.W, dungeon.H) * 0.5;
            this.scene.fog.near = mapRadius * 0.4;
            this.scene.fog.far = mapRadius * 3.5;
        }
    }

    triggerCameraTransition(target, frustumSize, duration = 1.0) {
        this.cameraTransition.startTarget.copy(this.controls.target);
        this.cameraTransition.startFrustum = this.camera.userData.frustumSize;

        this.cameraTransition.endTarget.copy(target);
        this.cameraTransition.endFrustum = frustumSize;

        this.cameraTransition.duration = duration;
        this.cameraTransition.elapsed = 0;
        this.cameraTransition.active = true;
    }

    update(dt) {
        if (this.cameraTransition.active) {
            this.cameraTransition.elapsed += dt;
            const progress = Math.min(this.cameraTransition.elapsed / this.cameraTransition.duration, 1.0);
            
            const ease = progress < 0.5 
                ? 2 * progress * progress 
                : 1 - Math.pow(-2 * progress + 2, 2) / 2;

            this.controls.target.lerpVectors(
                this.cameraTransition.startTarget,
                this.cameraTransition.endTarget,
                ease
            );

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

        this.controls.update();

        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

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

    clearScene() {
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
