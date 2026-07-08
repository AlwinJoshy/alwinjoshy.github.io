import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.117.1/build/three.module.js';

export class TerrainTiler {
    constructor(scene, config = {}) {
        this.scene = scene;
        
        // --- Configuration ---
        this.tileSize = config.tileSize || 5000; 
        this.gridSize = config.gridSize || 3;    
        
        // Now an array to hold your 5 LOD variations [LOD0, LOD1, LOD2, LOD3, LOD4]
        this.sourceLandLODs = [];
        this.sourceTrees = null;
        
        this.currentChunkX = NaN;
        this.currentChunkZ = NaN;

        this.activeTiles = new Map(); 
    }

    // Pass an array of your 5 land meshes (ordered from highest detail to lowest)
    init(landMeshArray, treesMesh) {
        this.sourceLandLODs = landMeshArray;
        this.sourceTrees = treesMesh;

        // Hide the original template meshes
        this.sourceLandLODs.forEach(mesh => { if(mesh) mesh.visible = false; });
        if (this.sourceTrees) this.sourceTrees.visible = false;
    }

    update(targetPosition) {
        if (this.sourceLandLODs.length === 0 || !this.sourceTrees) return;

        const cellX = Math.floor((targetPosition.x + this.tileSize / 2) / this.tileSize);
        const cellZ = Math.floor((targetPosition.z + this.tileSize / 2) / this.tileSize);

        if (cellX !== this.currentChunkX || cellZ !== this.currentChunkZ) {
            this.currentChunkX = cellX;
            this.currentChunkZ = cellZ;
            this.rebuildGrid(cellX, cellZ);
        }

        // CRITICAL PERFORMANCE FIX: 
        // Three.js native LOD requires you to call update(camera) on the object 
        // IF the objects are moving relative to the camera, or vice-versa.
        // However, because we are using a chase camera, updateMatrixWorld handles this.
    }

    rebuildGrid(centerChunkX, centerChunkZ) {
        const halfGrid = Math.floor(this.gridSize / 2);
        const visibleKeys = new Set();

        for (let xOffset = -halfGrid; xOffset <= halfGrid; xOffset++) {
            for (let zOffset = -halfGrid; zOffset <= halfGrid; zOffset++) {
                const cx = centerChunkX + xOffset;
                const cz = centerChunkZ + zOffset;
                const key = `${cx},${cz}`;
                visibleKeys.add(key);

                if (!this.activeTiles.has(key)) {
                    this.spawnTile(cx, cz, key);
                }
            }
        }

        for (const [key, tileObjects] of this.activeTiles.entries()) {
            if (!visibleKeys.has(key)) {
                this.scene.remove(tileObjects.lodContainer);
                this.scene.remove(tileObjects.treeInstance);
                this.activeTiles.delete(key);
            }
        }
    }

    spawnTile(chunkX, chunkZ, key) {
        // 1. Create a native native Three.js LOD manager
        const lod = new THREE.LOD();

        // 2. Add your 5 levels with explicit distance breaking points
        // Tweak these values based on how fast and high your Spitfire flies!
        lod.addLevel(this.sourceLandLODs[0].clone(), 0);     // 0m to 1500m -> Max Poly
        lod.addLevel(this.sourceLandLODs[1].clone(), 1500);  // 1500m to 3500m
        lod.addLevel(this.sourceLandLODs[2].clone(), 3500);  // 3500m to 6000m
        lod.addLevel(this.sourceLandLODs[3].clone(), 6000);  // 6000m to 10000m
        lod.addLevel(this.sourceLandLODs[4].clone(), 10000); // 10000m+ -> Flat Low-Poly Plane

        // Ensure all visibility restrictions are dropped on clones
        lod.children.forEach(child => child.visible = true);

        // 3. Clone trees (only for high detail close-up tracking)
        const treeClone = this.sourceTrees.clone();
        treeClone.visible = true;

        // Calculate world layout positioning offsets
        const worldX = chunkX * this.tileSize;
        const worldZ = chunkZ * this.tileSize;

        lod.position.set(worldX, 0, worldZ);
        treeClone.position.set(worldX, 0, worldZ);

        // Native LOD requires forcing matrix world configurations down to children components
        lod.updateMatrixWorld(true);

        this.scene.add(lod);
        this.scene.add(treeClone);

        this.activeTiles.set(key, {
            lodContainer: lod,
            treeInstance: treeClone
        });
    }
}