export class SceneBuilder {
    constructor(canvasContainer) {
        this.container = canvasContainer;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        
        this.instances = []; // [{ mesh, index, x, y, currentScale, targetScale, baseY, baseHeightScale }]
        this.gridLookup = {};
        this.geometries = [];
        this.materials = [];
        this.torchLights = [];

        this.init();
    }

    init() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x050811);

        const aspect = width / height;
        const frustumSize = 15;
        this.camera = new THREE.OrthographicCamera(
            -frustumSize * aspect / 2,
            frustumSize * aspect / 2,
            frustumSize / 2,
            -frustumSize / 2,
            0.1,
            1000
        );

        this.camera.position.set(20, 20, 20);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);

        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.05;

        const ambientLight = new THREE.HemisphereLight(0x1a2e40, 0x030712, 0.4);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0x4b70dd, 0.5);
        dirLight.position.set(10, 20, 15);
        this.scene.add(dirLight);

        window.addEventListener('resize', this.onResize.bind(this));
    }

    onResize() {
        if (!this.container || !this.renderer) return;
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        const aspect = w / h;
        const frustumSize = this.currentFrustumSize || 15;

        this.camera.left = -frustumSize * aspect / 2;
        this.camera.right = frustumSize * aspect / 2;
        this.camera.top = frustumSize / 2;
        this.camera.bottom = -frustumSize / 2;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(w, h);
    }

    buildDungeon(mapData, prng) {
        this.dispose();

        const grid = mapData.grid;
        const h = grid.length;
        const w = grid[0].length;

        const mapRadius = Math.max(w, h);
        this.scene.fog = new THREE.Fog(0x050811, mapRadius * 0.4, mapRadius * 2.2);

        const floorGeo = new THREE.BoxGeometry(1, 0.2, 1);
        const wallGeo = new THREE.BoxGeometry(1, 1.5, 1);
        const portalGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.4, 8);
        const chestGeo = new THREE.BoxGeometry(0.6, 0.5, 0.5);

        this.geometries.push(floorGeo, wallGeo, portalGeo, chestGeo);

        const floorMat = new THREE.MeshPhongMaterial({ color: 0x222e40, shininess: 5 });
        const wallMat = new THREE.MeshPhongMaterial({ color: 0x0f1521, shininess: 2 });
        const portalMat = new THREE.MeshPhongMaterial({ color: 0x00ffcc, emissive: 0x003322 });
        const chestMat = new THREE.MeshPhongMaterial({ color: 0x9c661f, shininess: 10 });

        this.materials.push(floorMat, wallMat, portalMat, chestMat);

        let floorCount = 0;
        let wallCount = 0;
        let chestCount = mapData.chests.length;
        let portalCount = 1;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (grid[y][x] === 1) floorCount++;
                else if (grid[y][x] === 2) wallCount++;
            }
        }

        const floorMesh = new THREE.InstancedMesh(floorGeo, floorMat, floorCount);
        const wallMesh = new THREE.InstancedMesh(wallGeo, wallMat, wallCount);
        const portalMesh = new THREE.InstancedMesh(portalGeo, portalMat, portalCount);
        const chestMesh = new THREE.InstancedMesh(chestGeo, chestMat, chestCount);

        this.scene.add(floorMesh);
        this.scene.add(wallMesh);
        this.scene.add(portalMesh);
        this.scene.add(chestMesh);

        let floorIdx = 0, wallIdx = 0;
        const tempMatrix = new THREE.Matrix4();
        const tempPos = new THREE.Vector3();
        const tempRot = new THREE.Euler();
        const tempScale = new THREE.Vector3();

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const cell = grid[y][x];
                const key = `${x},${y}`;

                if (cell === 1) {
                    tempPos.set(x, 0.1, y);
                    tempScale.set(1, 0, 1); 
                    tempRot.set(0, 0, 0);
                    tempMatrix.compose(tempPos, new THREE.Quaternion().setFromEuler(tempRot), tempScale);
                    floorMesh.setMatrixAt(floorIdx, tempMatrix);

                    const inst = {
                        mesh: floorMesh, index: floorIdx, x, y,
                        currentScale: 0, targetScale: 0,
                        baseY: 0.1, baseHeightScale: 1
                    };
                    this.instances.push(inst);
                    this.gridLookup[key] = inst;
                    floorIdx++;
                } else if (cell === 2) {
                    tempPos.set(x, 0.75, y);
                    tempScale.set(1, 0, 1);
                    tempRot.set(0, 0, 0);
                    tempMatrix.compose(tempPos, new THREE.Quaternion().setFromEuler(tempRot), tempScale);
                    wallMesh.setMatrixAt(wallIdx, tempMatrix);

                    const inst = {
                        mesh: wallMesh, index: wallIdx, x, y,
                        currentScale: 0, targetScale: 0,
                        baseY: 0.75, baseHeightScale: 1
                    };
                    this.instances.push(inst);
                    this.gridLookup[key] = inst;
                    wallIdx++;
                }
            }
        }

        // Портал
        tempPos.set(mapData.portal.x, 0.3, mapData.portal.y);
        tempScale.set(1, 0, 1);
        tempRot.set(0, 0, 0);
        tempMatrix.compose(tempPos, new THREE.Quaternion().setFromEuler(tempRot), tempScale);
        portalMesh.setMatrixAt(0, tempMatrix);
        const portalInst = {
            mesh: portalMesh, index: 0, x: mapData.portal.x, y: mapData.portal.y,
            currentScale: 0, targetScale: 0, baseY: 0.3, baseHeightScale: 1
        };
        this.instances.push(portalInst);
        this.gridLookup[`${mapData.portal.x},${mapData.portal.y}_portal`] = portalInst;

        // Сундуки
        mapData.chests.forEach((chest, idx) => {
            tempPos.set(chest.x, 0.35, chest.y);
            tempScale.set(1, 0, 1);
            tempRot.set(0, prng.next() * Math.PI, 0);
            tempMatrix.compose(tempPos, new THREE.Quaternion().setFromEuler(tempRot), tempScale);
            chestMesh.setMatrixAt(idx, tempMatrix);

            const chestInst = {
                mesh: chestMesh, index: idx, x: chest.x, y: chest.y,
                currentScale: 0, targetScale: 0, baseY: 0.35, baseHeightScale: 1
            };
            this.instances.push(chestInst);
            this.gridLookup[`${chest.x},${chest.y}_chest`] = chestInst;
        });

        this.setupWarmTorchLights(mapData, prng);
        this.fitCameraToGrid(w, h);
    }

    setupWarmTorchLights(mapData, prng) {
        const candidates = [];
        const grid = mapData.grid;
        const h = grid.length;
        const w = grid[0].length;

        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                if (grid[y][x] === 2) {
                    if (grid[y+1][x] === 1 || grid[y-1][x] === 1 || grid[y][x+1] === 1 || grid[y][x-1] === 1) {
                        candidates.push({ x, y });
                    }
                }
            }
        }

        if (candidates.length === 0) return;

        // Метод Farthest Point Sampling (FPS) с ограничением в 12 источников
        const limit = Math.min(12, candidates.length);
        const selected = [];

        const firstIdx = prng.rangeInt(0, candidates.length);
        selected.push(candidates[firstIdx]);

        while (selected.length < limit) {
            let maxMinDist = -1;
            let bestCand = null;

            for (const cand of candidates) {
                if (selected.includes(cand)) continue;

                let minDist = Infinity;
                for (const sel of selected) {
                    const d = Math.pow(cand.x - sel.x, 2) + Math.pow(cand.y - sel.y, 2);
                    if (d < minDist) {
                        minDist = d;
                    }
                }

                if (minDist > maxMinDist) {
                    maxMinDist = minDist;
                    bestCand = cand;
                }
            }

            if (bestCand) {
                selected.push(bestCand);
            } else {
                break;
            }
        }

        selected.forEach(pt => {
            const torchLight = new THREE.PointLight(0xff6611, 1.8, 4.5, 1.5);
            torchLight.position.set(pt.x, 1.1, pt.y);
            this.scene.add(torchLight);
            this.torchLights.push(torchLight);

            const torchGeo = new THREE.SphereGeometry(0.08, 4, 4);
            const torchMat = new THREE.MeshBasicMaterial({ color: 0xffaa44 });
            const torchMesh = new THREE.Mesh(torchGeo, torchMat);
            torchMesh.position.set(pt.x, 1.1, pt.y);
            this.scene.add(torchMesh);
            this.torchLights.push(torchMesh); 
        });
    }

    fitCameraToGrid(gridW, gridH) {
        const center = new THREE.Vector3(gridW / 2, 0, gridH / 2);
        this.controls.target.copy(center);

        const span = Math.max(gridW, gridH);
        const aspect = this.container.clientWidth / this.container.clientHeight;
        
        let targetFrustum = span * 1.0;
        if (aspect < 1) { 
            targetFrustum = span * 1.4;
        }

        this.currentFrustumSize = targetFrustum;
        this.camera.left = -targetFrustum * aspect / 2;
        this.camera.right = targetFrustum * aspect / 2;
        this.camera.top = targetFrustum / 2;
        this.camera.bottom = -targetFrustum / 2;

        this.camera.position.set(center.x + 20, center.y + 20, center.z + 20);
        this.camera.updateProjectionMatrix();
        this.controls.update();
    }

    updateAnimation(deltaTime) {
        // Плавная анимация упругого масштабирования тайлов
        const tempMatrix = new THREE.Matrix4();
        const tempPos = new THREE.Vector3();
        const tempScale = new THREE.Vector3();
        const tempQuat = new THREE.Quaternion();

        const speed = 7.5; 

        this.instances.forEach(inst => {
            const diff = inst.targetScale - inst.currentScale;
            if (Math.abs(diff) > 0.001) {
                inst.currentScale += diff * speed * deltaTime;
                if (inst.currentScale < 0) inst.currentScale = 0;
                if (inst.currentScale > 1) inst.currentScale = 1;

                inst.mesh.getMatrixAt(inst.index, tempMatrix);
                tempMatrix.decompose(tempPos, tempQuat, tempScale);

                const yVal = inst.currentScale * inst.baseHeightScale;
                tempScale.set(inst.currentScale, yVal, inst.currentScale);
                tempPos.y = inst.baseY * inst.currentScale;

                tempMatrix.compose(tempPos, tempQuat, tempScale);
                inst.mesh.setMatrixAt(inst.index, tempMatrix);
                inst.mesh.instanceMatrix.needsUpdate = true;
            }
        });
    }

    setTileVisibility(x, y, visible, type = null) {
        let key = `${x},${y}`;
        if (type) key += `_${type}`;

        const inst = this.gridLookup[key];
        if (inst) {
            inst.targetScale = visible ? 1 : 0;
        }
    }

    dispose() {
        this.torchLights.forEach(light => {
            this.scene.remove(light);
            if (light.geometry) light.geometry.dispose();
            if (light.material) {
                if (Array.isArray(light.material)) {
                    light.material.forEach(m => m.dispose());
                } else {
                    light.material.dispose();
                }
            }
        });
        this.torchLights = [];

        this.instances.forEach(inst => {
            this.scene.remove(inst.mesh);
        });
        
        this.geometries.forEach(g => g.dispose());
        this.materials.forEach(m => m.dispose());

        this.geometries = [];
        this.materials = [];
        this.instances = [];
        this.gridLookup = {};
    }
}
