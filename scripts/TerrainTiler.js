import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.117.1/build/three.module.js';

export class TerrainTiler {
    constructor(scene, config = {}) {
        this.scene = scene;
        
        // --- Configuration ---
        this.tileSize = config.tileSize || 5000; // 5km tiles
        this.gridSize = config.gridSize || 3;    // 3 means 3x3 tiles, 4 means 4x4 tiles
        
        this.sourceLand = null;
        this.sourceTrees = null;
        
        // Tracks the current central chunk index the plane is flying over
        this.currentChunkX = NaN;
        this.currentChunkZ = NaN;

        // Active active pool grids
        this.activeTiles = new Map(); // Key: "x,z" -> Value: { landGroup, treeGroup }
    }

    // Call this once your GLTFLoader completes loading the meshes
    init(landMesh, treesMesh) {
        this.sourceLand = landMesh;
        this.sourceTrees = treesMesh;

        // Ensure the source meshes don't render directly at the center origin
        this.sourceLand.visible = false;
        this.sourceTrees.visible = false;
    }

    update(targetPosition) {
        if (!this.sourceLand || !this.sourceTrees) return;

        // Calculate which grid cell coordinates the aircraft is currently over
        const chunkX = Math.floor((targetPosition.x + this.tileSize / 2) / this.tileSize);
        const chunkZ = Math.floor((targetPosition.z + this.tileSize / 2) / this.tileSize);

        // If the aircraft hasn't crossed a boundary into a new grid cell, do nothing
        if (chunkX === this.currentChunkX && chunkZ === this.currentChunkZ) return;

        this.currentChunkX = chunkX;
        this.currentChunkZ = chunkZ;

        this.updateGrid(chunkX, chunkZ);
    }

    updateGrid(centerChunkX, centerChunkZ) {
        const visibleKeys = new Set();
        const halfGrid = Math.floor(this.gridSize / 2);

        // 1. Calculate which tiles should exist in our NxN window grid
        for (let xOffset = -halfGrid; xOffset <= halfGrid; xOffset++) {
            for (let zOffset = -halfGrid; zOffset <= halfGrid; zOffset++) {
                
                // For even numbers like 4x4, shift offsets to balance grid centering
                if (this.gridSize % 2 === 0 && xOffset === halfGrid) continue;
                if (this.gridSize % 2 === 0 && zOffset === halfGrid) continue;

                const targetChunkX = centerChunkX + xOffset;
                const targetChunkZ = centerChunkZ + zOffset;
                const key = `${targetChunkX},${targetChunkZ}`;
                visibleKeys.add(key);

                // If the tile doesn't exist yet, spawn/clone it from our pool template
                if (!this.activeTiles.has(key)) {
                    this.spawnTile(targetChunkX, targetChunkZ, key);
                }
            }
        }

        // 2. Clean up/remove tiles that have fallen outside the view distance radius
        for (const [key, tileObjects] of this.activeTiles.entries()) {
            if (!visibleKeys.has(key)) {
                this.scene.remove(tileObjects.landInstance);
                this.scene.remove(tileObjects.treeInstance);
                
                // Optional optimization: You could push these to an array pool 
                // to reuse instead of disposing, but simple removals work smoothly
                this.activeTiles.delete(key);
            }
        }
    }

    spawnTile(chunkX, chunkZ, key) {
        // Clone the parent hierarchies for this specific coordinate block
        const landClone = this.sourceLand.clone();
        const treeClone = this.sourceTrees.clone();

        landClone.visible = true;
        treeClone.visible = true;

        // Calculate the physical 3D world position coordinates for this chunk
        const worldX = chunkX * this.tileSize;
        const worldZ = chunkZ * this.tileSize;

        landClone.position.set(worldX, 0, worldZ);
        treeClone.position.set(worldX, 0, worldZ);

        this.scene.add(landClone);
        this.scene.add(treeClone);

        // Cache references to manage visibility thresholds later
        this.activeTiles.set(key, {
            landInstance: landClone,
            treeInstance: treeClone
        });
    }
}