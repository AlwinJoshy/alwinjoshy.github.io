import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.117.1/build/three.module.js';

// Fixed-pool terrain tiler.
// - (2*floor(gridSize/2)+1)^2 tiles (gridSize 4 -> 5x5) are built ONCE in init(); each tile is a THREE.LOD with
//   two land levels (LOD0 near, LOD1 from lod1Distance) plus a trees clone.
// - When the plane crosses into a new cell, tiles that fell out of range are moved to the newly needed cells
//   (reposition + updateMatrixWorld only). No cloning, allocation, string keys or Map/Set churn after init.
// - LOD switching: r117 calls lod.update(camera) for every visible LOD (autoUpdate = true) during render.
// - Distant levels (old LOD2-4 at 3500+) are dropped: the scene fog is fully opaque by ~1700 and far is ~2465.
export class TerrainTiler {
    constructor(scene, config = {}) {
        this.scene = scene;
        this.tileSize = config.tileSize || 5000;
        this.gridSize = config.gridSize || 3;
        this.lod1Distance = config.lod1Distance || 1500;
        this.half = Math.floor(this.gridSize / 2);
        this.span = this.half * 2 + 1;
        this.tiles = [];            // { lod, trees, cx, cz }
        this.currentChunkX = NaN; this.currentChunkZ = NaN;
    }

    // landMeshArray: [LOD0, LOD1, ...] (only the first two are used); treesMesh: scatter mesh
    init(landMeshArray, treesMesh) {
        if (this.tiles.length) return;
        landMeshArray.forEach(m => { if (m) m.visible = false; });
        if (treesMesh) treesMesh.visible = false;
        const n = this.span * this.span;
        for (let i = 0; i < n; i++) {
            const lod = new THREE.LOD();
            const l0 = landMeshArray[0].clone(), l1 = (landMeshArray[1] || landMeshArray[0]).clone();
            l0.visible = l1.visible = true;
            lod.addLevel(l0, 0);
            lod.addLevel(l1, this.lod1Distance);
            lod.matrixAutoUpdate = false;
            const trees = treesMesh.clone(); trees.visible = true; trees.matrixAutoUpdate = false;
            this.scene.add(lod); this.scene.add(trees);
            this.tiles.push({ lod, trees, cx: NaN, cz: NaN, keep: false });
        }
        this.currentChunkX = NaN; this.currentChunkZ = NaN;
    }

    update(targetPosition) {
        if (!this.tiles.length) return;
        const s = this.tileSize;
        const cellX = Math.floor((targetPosition.x + s / 2) / s);
        const cellZ = Math.floor((targetPosition.z + s / 2) / s);
        if (cellX === this.currentChunkX && cellZ === this.currentChunkZ) return;
        this.currentChunkX = cellX; this.currentChunkZ = cellZ;
        this._relayout(cellX, cellZ);
    }

    _relayout(cx0, cz0) {
        const h = this.half, span = this.span, tiles = this.tiles;
        // 1. which wanted cells are already covered? (bitmask over the span x span window, no allocation)
        let covered = 0;   // up to 7x7 = 49 bits -> use two numbers if larger; 5x5 = 25 bits fits
        const big = span * span > 30;
        const cov = big ? (this._cov || (this._cov = new Uint8Array(span * span))) : null;
        if (big) cov.fill(0);
        for (let i = 0; i < tiles.length; i++) {
            const t = tiles[i], dx = t.cx - cx0 + h, dz = t.cz - cz0 + h;
            if (dx >= 0 && dx < span && dz >= 0 && dz < span) {
                const k = dz * span + dx;
                if (big) cov[k] = 1; else covered |= (1 << k);
                t.keep = true;
            } else t.keep = false;
        }
        // 2. move every out-of-range tile into an uncovered cell
        let k = 0;
        for (let i = 0; i < tiles.length; i++) {
            const t = tiles[i];
            if (t.keep) continue;
            while (k < span * span && (big ? cov[k] : (covered >> k) & 1)) k++;
            if (k >= span * span) break;
            const dx = k % span, dz = (k / span) | 0;
            k++;
            t.cx = cx0 + dx - h; t.cz = cz0 + dz - h;
            const x = t.cx * this.tileSize, z = t.cz * this.tileSize;
            t.lod.position.set(x, 0, z); t.lod.updateMatrix(); t.lod.updateMatrixWorld(true);
            t.trees.position.set(x, 0, z); t.trees.updateMatrix(); t.trees.updateMatrixWorld(true);
        }
    }
}
