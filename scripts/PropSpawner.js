import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.117.1/build/three.module.js';

/*
 * PropSpawner: trees / buildings placed on Blender-exported spawn points, repeated on every terrain tile.
 *
 * FILES (paths relative to the site root)
 *   assets/models/spawn_trees.glb      tree spawn points      (nodes named *Tree*)
 *   assets/models/spawn_buildings.glb  building spawn points  (nodes named *House* / *Building*)
 *   assets/models/spawn_*.json         optional fallback, used only if the GLB fails:
 *       { "points": [ [x, y, z, rotY, scale, variant?], ... ] }   or
 *       { "points": [ { "p": [x,y,z], "q": [qx,qy,qz,qw] | "ry": radians, "s": n | [sx,sy,sz], "v": variant }, ... ] }
 *   assets/models/props/trees.glb      variant meshes: one top-level object per variant (Tree_01..03), sorted by name
 *   assets/models/props/trees_lod.glb  optional LOD per tree variant (Tree_LODs_Tree_01..03, matched by name in threeJS_WWII)
 *   assets/models/props/buildings.glb  Building_Big_House_01, _Church_01, _Medium_House_01, _Small_House_01, _Tower_01
 *       A variant may have several sub-meshes / materials (e.g. trunk + alpha-cut leaves): each part becomes its
 *       own InstancedMesh sharing the variant's instance pool. The object's rotation/scale are baked in, its
 *       position is ignored. Origin = ground contact; if the origin lies outside the model's vertical extent the
 *       bounding box is used instead (min y -> 0). Buried foundations below the origin are kept.
 *       Placeholders (cones / boxes) are generated if a variant file is missing.
 *
 * POINT FORMAT (what is read from a points GLB)
 *   - Empties (nodes with no mesh and no children): world position, rotation and scale are used as-is.
 *   - Mesh / point-cloud objects: every vertex becomes a point (no rotation; scale 1).
 *   - Only objects whose name matches the set's filter are used (so one file can hold both kinds).
 *   - Variant per point: custom property "variant" (int), else a name tag "_v2" / "variant2", else a stable hash.
 *
 * BLENDER EXPORT (File > Export > glTF 2.0)
 *   glTF Binary (.glb), Selected Objects, Custom Properties on, +Y Up. Same scene / units as the landscape: points
 *   must be in the terrain's own space (one tile centred on the origin, x/z within +-tileSize/2). Don't parent the
 *   empties under a scaled object. Prop meshes: alpha-cut foliage as Alpha Clip (BLEND is converted to a cutout).
 *
 * RUNTIME
 *   - Every placed instance = (tile cell, point). Its Y rotation, scale jitter and spawn chance come from a hash
 *     of (cell, point index, seed), so they're stable when it re-shows and differ between repeated tiles.
 *   - Distance check every `interval` s: show within spawnDistance, hide beyond spawnDistance + buffer.
 *   - Instance pool per variant: fixed capacity (max visible estimate x headroom), slots [0, live) are in use and
 *     [live, capacity) are the free list. Show = take slot `live++`; hide = move the last live slot into the hole
 *     (one matrix copy) and `live--`. The draw count is always exactly the live count (no hidden/degenerate
 *     instances drawn) and only the touched slot range is re-uploaded (BufferAttribute.updateRange).
 *   - No allocation after init: all state is typed arrays sized at addSet().
 *   - Optional LOD per variant (addSet so.lod = { variants, distance, buffer }): a second instanced pool with the
 *     low-detail mesh. Inside `distance` an instance is in the full pool, beyond distance + buffer in the LOD pool,
 *     in between it keeps its pool (hysteresis). Decided in the same distance check (no per-frame work); a swap
 *     copies the instance matrix across (same position / rotation / scale) and frees the old slot in the same
 *     upload, so each instance is drawn by exactly one pool. Full pools are sized for the near disc only; if one is
 *     full the instance just stays a LOD.
 */

const PLACEHOLDER_TREE = [0x1c2b14, 0x243318, 0x182611], PLACEHOLDER_BUILDING = [0x6e6052, 0x7a6a5a, 0x5e5449, 0x84745f, 0x55504a];
const EMPTY = 0x7fffffff;

// small integer hash -> [0, 1)
function hash01(a, b, c, d) {
    let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519) ^ Math.imul(d | 0, 3266489917);
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

export class PropSpawner {
    constructor(scene, opts = {}) {
        this.scene = scene;
        this.o = Object.assign({
            tileSize: 1042,
            spawnDistance: 1500,       // show inside this (fog 300-1700)
            buffer: 200,               // hide beyond spawnDistance + buffer
            interval: 0.5,             // seconds between distance checks
            cellSize: 130,             // spatial grid bucket size (tile-local)
            headroom: 1.35,            // pool capacity = max visible estimate x headroom (+16)
            castShadow: true, receiveShadow: false
        }, opts);
        this.sets = [];
        this._timer = 0;
        this.stats = { visible: 0, lod: 0, uploads: 0, checks: 0, overflow: 0, swaps: 0, capacity: 0 };
    }

    // ---- point loading ------------------------------------------------------------------------------------
    // Returns a Float32Array of packed points: [m0..m15 (matrix), variantTag] per point (variantTag -1 = hash).
    static async loadPoints(gltfLoader, url, filter, jsonUrl) {
        try {
            const gltf = await new Promise((res, rej) => gltfLoader.load(url, res, undefined, rej));
            const pts = PropSpawner.pointsFromObject(gltf.scene, filter);
            if (pts.length) return pts;
            throw new Error('no points matching ' + filter + ' in ' + url);
        } catch (e) {
            if (!jsonUrl) throw e;
            const r = await fetch(jsonUrl);
            if (!r.ok) throw e;
            return PropSpawner.pointsFromJSON(await r.json());
        }
    }

    static pointsFromObject(root, filter) {
        root.updateMatrixWorld(true);
        const out = [], m = new THREE.Matrix4(), v = new THREE.Vector3();
        const tagOf = (o) => {
            const ud = o.userData || {};
            if (ud.variant !== undefined && isFinite(+ud.variant)) return +ud.variant;
            const mt = /(?:^|[_\-\s.])v(?:ariant)?[_-]?(\d+)/i.exec(o.name || '');
            return mt ? +mt[1] : -1;
        };
        root.traverse((o) => {
            if (o === root || (filter && !filter.test(o.name || ''))) return;
            const g = o.geometry;
            if (g && g.attributes && g.attributes.position) {          // vertex cloud: one point per vertex
                const p = g.attributes.position, tag = tagOf(o);
                for (let i = 0; i < p.count; i++) {
                    v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
                    m.makeTranslation(v.x, v.y, v.z);
                    out.push(...m.elements, tag);
                }
            } else if (!o.children.length) {                           // empty
                out.push(...o.matrixWorld.elements, tagOf(o));
            }
        });
        return new Float32Array(out);
    }

    static pointsFromJSON(json) {
        const list = Array.isArray(json) ? json : json.points || [];
        const out = new Float32Array(list.length * 17), m = new THREE.Matrix4(), q = new THREE.Quaternion(),
            p = new THREE.Vector3(), s = new THREE.Vector3(), e = new THREE.Euler();
        list.forEach((it, i) => {
            let tag = -1;
            if (Array.isArray(it)) {
                p.set(it[0], it[1], it[2]); q.setFromEuler(e.set(0, it[3] || 0, 0)); s.setScalar(it[4] || 1);
                if (it.length > 5) tag = it[5];
            } else {
                p.fromArray(it.p || [0, 0, 0]);
                if (it.q) q.fromArray(it.q); else q.setFromEuler(e.set(0, it.ry || 0, 0));
                if (Array.isArray(it.s)) s.fromArray(it.s); else s.setScalar(it.s || 1);
                if (it.v !== undefined) tag = it.v;
            }
            m.compose(p, q, s);
            out.set(m.elements, i * 17); out[i * 17 + 16] = tag;
        });
        return out;
    }

    // Placeholder points (only if no points file is available): random points over one tile.
    static placeholderPoints(count, tileSize, seed = 1) {
        const out = new Float32Array(count * 17), m = new THREE.Matrix4();
        let st = seed * 9973 + 7; const rnd = () => { st = (st * 16807) % 2147483647; return st / 2147483647; };
        for (let i = 0; i < count; i++) {
            m.makeTranslation((rnd() - 0.5) * tileSize, 0, (rnd() - 0.5) * tileSize);
            out.set(m.elements, i * 17); out[i * 17 + 16] = -1;
        }
        return out;
    }

    // ---- variant meshes ------------------------------------------------------------------------------------
    // A variant = { parts: [{ geometry, material }] }.
    static placeholderVariants(kind) {
        const list = [];
        const mat = (c) => new THREE.MeshPhongMaterial({ color: c, specular: 0x000000, shininess: 1, flatShading: true });
        if (kind === 'trees') {
            [[3.2, 11, 6], [4.2, 9, 7], [2.6, 14, 5]].forEach(([r, hgt, seg], i) => {
                const g = new THREE.ConeBufferGeometry(r, hgt, seg, 1); g.translate(0, hgt / 2 - 2, 0);
                list.push({ parts: [{ geometry: g, material: mat(PLACEHOLDER_TREE[i]) }] });
            });
        } else {
            [[8, 6, 10], [12, 5, 8], [6, 9, 6], [14, 7, 10], [7, 4, 7]].forEach(([x, y, z], i) => {
                const g = new THREE.BoxBufferGeometry(x, y + 2, z); g.translate(0, (y + 2) / 2 - 2, 0);
                list.push({ parts: [{ geometry: g, material: mat(PLACEHOLDER_BUILDING[i]) }] });
            });
        }
        return list;
    }

    // Variant meshes from one GLB: each top-level object (sorted by name) is a variant; every mesh below it is a
    // part, baked into the variant's local space (object rotation/scale kept, object position dropped).
    // opts.sink: metres pushed into the ground (hides small terrain mismatches); opts.material(m): convert hook.
    static async loadVariants(gltfLoader, url, opts = {}) {
        const sink = opts.sink || 0;
        const gltf = await new Promise((res, rej) => gltfLoader.load(url, res, undefined, rej));
        const root = gltf.scene; root.updateMatrixWorld(true);
        const objs = root.children.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        const m = new THREE.Matrix4(), box = new THREE.Box3(), pb = new THREE.Box3();
        const converted = new Map();
        const variants = [];
        for (const obj of objs) {
            // variant space = object's world transform without its translation
            const objInvT = new THREE.Matrix4().makeTranslation(-obj.matrixWorld.elements[12], -obj.matrixWorld.elements[13], -obj.matrixWorld.elements[14]);
            const parts = [];
            box.makeEmpty();
            obj.traverse((o) => {
                if (!o.isMesh) return;
                const g = o.geometry.clone();
                m.multiplyMatrices(objInvT, o.matrixWorld); g.applyMatrix4(m);
                g.computeBoundingBox(); pb.copy(g.boundingBox); box.union(pb);
                let mat = o.material;
                if (opts.material) { if (!converted.has(mat)) converted.set(mat, opts.material(mat)); mat = converted.get(mat); }
                parts.push({ geometry: g, material: mat });
            });
            if (!parts.length) continue;
            // ground the variant: origin is the ground contact unless it lies outside the model's vertical extent
            const dy = (box.min.y > 0.05 || box.max.y < 0) ? -box.min.y : 0;
            for (const p of parts) if (dy - sink !== 0) p.geometry.translate(0, dy - sink, 0);
            variants.push({ name: obj.name, parts, height: box.max.y - box.min.y, grounded: dy !== 0 ? 'bbox' : 'origin' });
        }
        return variants;
    }

    // glTF Standard -> Phong (same lighting path as the terrain: cheaper, and no environment-map tint).
    // Alpha BLEND/MASK -> alpha-tested cutout (sorting-free with instancing, writes depth, casts cut-out shadows).
    // Vertex normals are used as authored (no flat shading, no recomputation). Double-sided cut-out foliage keeps
    // its custom rounded normals on BOTH faces (three normally flips the normal on back faces, which would turn
    // the sphere-like foliage lighting inside out on half the cards); set flipBackfaceNormals to restore that.
    static toPhong(src, alphaTest = 0.5, flipBackfaceNormals = false) {
        const cut = src.transparent || src.alphaTest > 0;
        const m = new THREE.MeshPhongMaterial({
            name: src.name, color: src.color ? src.color.clone() : 0xffffff, map: src.map || null,
            specular: 0x000000, shininess: 1, side: src.side, flatShading: false,
            alphaTest: cut ? (src.alphaTest > 0 ? src.alphaTest : alphaTest) : 0, transparent: false
        });
        if (cut && src.side === THREE.DoubleSide && !flipBackfaceNormals) {
            m.userData.roundedNormals = true;
            m.onBeforeCompile = (sh) => {
                sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>',
                    THREE.ShaderChunk.normal_fragment_begin.replace('normal = normal * ( float( gl_FrontFacing ) * 2.0 - 1.0 );', ''));
            };
        }
        return m;
    }

    // ---- sets ---------------------------------------------------------------------------------------------
    // name: label; points: packed Float32Array (17 per point); variants: [{ parts: [{geometry, material}] }];
    // decorate(material): fog / cloud shadows etc. (once per material);
    // so: { chance (0..1), randomRotation (bool), scaleJitter (0..1, +-fraction), weights ([per variant]), seed }
    addSet(name, points, variants, decorate, so = {}) {
        so = Object.assign({ chance: 1, randomRotation: true, scaleJitter: 0, seed: name.length * 131 }, so);
        const o = this.o, s = o.tileSize, half = s / 2, N = (points.length / 17) | 0, V = variants.length;
        const px = new Float32Array(N), pz = new Float32Array(N), variant = new Uint8Array(N), local = new Float32Array(N * 16);
        const wts = new Float32Array(V).fill(1);
        if (so.weights) for (let k = 0; k < V; k++) wts[k] = Math.max(0, so.weights[k] !== undefined ? so.weights[k] : 1);
        let wSum = 0; for (let k = 0; k < V; k++) wSum += wts[k];
        if (!(wSum > 0)) { wts.fill(1); wSum = V; }
        for (let i = 0; i < N; i++) {
            const b = i * 17;
            let x = points[b + 12], z = points[b + 14];
            x = x - Math.floor((x + half) / s) * s; z = z - Math.floor((z + half) / s) * s;   // wrap into one tile
            px[i] = x; pz[i] = z;
            for (let k = 0; k < 16; k++) local[i * 16 + k] = points[b + k];
            local[i * 16 + 12] = x; local[i * 16 + 14] = z;
            const tag = points[b + 16];
            if (tag >= 0) variant[i] = (tag | 0) % V;
            else {                                          // hashed pick, optionally weighted (so.weights, by variant order)
                let h = hash01(Math.round(x * 10), Math.round(z * 10), 17, so.seed) * wSum, k = 0;
                while (k < V - 1 && h >= wts[k]) { h -= wts[k]; k++; }
                variant[i] = k;
            }
        }
        // spatial grid (CSR): bucket -> point indices
        const g = Math.max(1, Math.ceil(s / o.cellSize)), cs = s / g;
        const start = new Uint32Array(g * g + 1), idx = new Uint32Array(N), bucketOf = new Uint32Array(N);
        for (let i = 0; i < N; i++) {
            const bx = Math.min(g - 1, Math.max(0, Math.floor((px[i] + half) / cs))), bz = Math.min(g - 1, Math.max(0, Math.floor((pz[i] + half) / cs)));
            bucketOf[i] = bz * g + bx; start[bucketOf[i] + 1]++;
        }
        for (let b = 0; b < g * g; b++) start[b + 1] += start[b];
        const fill = start.slice(0, g * g);
        for (let i = 0; i < N; i++) idx[fill[bucketOf[i]]++] = i;

        // window of tile cells around the target; state per (window slot, point)
        const hideR = o.spawnDistance + o.buffer, R = Math.ceil(hideR / s + 0.5), W = 2 * R + 1;
        const set = {
            name, N, V, px, pz, local, variant, g, cs, start, idx, so, R, W,
            live: new Int32Array(W * W * N),                 // pool slot + 1 of (window slot, point); 0 = hidden
            slotLive: new Uint32Array(W * W),                // live instances per window slot (fast skip)
            slotCx: new Int32Array(W * W).fill(EMPTY), slotCz: new Int32Array(W * W),
            pools: [], lodPools: [], hasLod: false, visible: 0, lodVisible: 0
        };
        // pools: capacity from the max visible estimate (points of that variant inside a hide-radius disc)
        const counts = new Uint32Array(V); for (let i = 0; i < N; i++) counts[variant[i]]++;
        const estTiles = Math.PI * hideR * hideR / (s * s);
        // LOD (optional): so.lod = { variants: [lodVariant | null per variant], distance, buffer }. Beyond `distance`
        // (+ buffer, hysteresis) an instance lives in the variant's LOD pool instead of the full pool (never both).
        const lodList = so.lod && so.lod.variants ? so.lod.variants : null;
        const hasLod = !!lodList && so.lod.distance >= 0 && lodList.some((x) => x && x.parts && x.parts.length);
        set.lodPools = new Array(V).fill(null);
        set.hasLod = hasLod;
        if (hasLod) { so.lodDistance = so.lod.distance; so.lodBuffer = so.lod.buffer; }
        // full pools with LOD: sized from the densest sampled near disc (radius distance + buffer); overflow
        // just leaves the instance as a LOD (no missing trees). LOD pools take the old (whole range) size.
        const nearPeak = hasLod ? this._peakCounts(set, Math.min(so.lodDistance + so.lodBuffer, hideR)) : null;
        const makePool = (v, vdef, cap, sign, tag) => {
            const attr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16);
            attr.setUsage(THREE.DynamicDrawUsage);
            const pool = { cap, live: 0, attr, arr: attr.array, owner: new Int32Array(cap), sign, dMin: EMPTY, dMax: -1, parts: [], countDirty: false };
            for (const part of vdef.parts) {
                const mat = part.material;
                if (decorate && !mat.userData.__propDecorated) { decorate(mat); mat.userData.__propDecorated = true; }
                const im = new THREE.InstancedMesh(part.geometry, mat, cap);
                im.instanceMatrix = attr;                    // all parts of a variant share one pool / one buffer
                im.count = 0; im.visible = false; im.frustumCulled = false;
                im.castShadow = o.castShadow; im.receiveShadow = o.receiveShadow;
                if (o.castShadow && mat.alphaTest > 0) {     // cut-out shadows for alpha-tested foliage
                    im.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: mat.map, alphaTest: mat.alphaTest, side: mat.side });
                }
                im.matrixAutoUpdate = false; im.name = name + '_' + (vdef.name || v) + tag;
                this.scene.add(im);
                pool.parts.push(im);
            }
            this.stats.capacity += cap;
            return pool;
        };
        for (let v = 0; v < V; v++) {
            const capAll = Math.ceil(counts[v] * Math.min(1, so.chance) * estTiles * o.headroom) + 16;
            const lv = hasLod ? lodList[v] : null, withLod = !!(lv && lv.parts && lv.parts.length);
            const capFull = withLod ? Math.min(capAll, Math.ceil(nearPeak[v] * Math.min(1, so.chance) * o.headroom) + 16) : capAll;
            set.pools.push(makePool(v, variants[v], capFull, 1, ''));
            if (withLod) set.lodPools[v] = makePool(v, lv, capAll, -1, '_lod');
        }
        this.sets.push(set);
        this._timer = o.interval;   // check on the next update
        return set;
    }

    // Max points per variant inside a disc of radius r, sampled on a grid over one tile (tiles repeat).
    _peakCounts(set, r) {
        const s = this.o.tileSize, { N, V, px, pz, variant } = set, r2 = r * r, K = Math.ceil(r / s), G = 12;
        const peak = new Uint32Array(V), c = new Uint32Array(V);
        for (let gz = 0; gz < G; gz++) for (let gx = 0; gx < G; gx++) {
            const sx = -s / 2 + (gx + 0.5) * s / G, sz = -s / 2 + (gz + 0.5) * s / G;
            c.fill(0);
            for (let i = 0; i < N; i++) for (let oz = -K; oz <= K; oz++) for (let ox = -K; ox <= K; ox++) {
                const dx = px[i] + ox * s - sx, dz = pz[i] + oz * s - sz;
                if (dx * dx + dz * dz <= r2) c[variant[i]]++;
            }
            for (let v = 0; v < V; v++) if (c[v] > peak[v]) peak[v] = c[v];
        }
        return peak;
    }

    setChance(name, chance) { for (const st of this.sets) if (st.name === name) st.so.chance = chance; this._timer = this.o.interval; }

    // ---- runtime ------------------------------------------------------------------------------------------
    // target: plane (or camera) world position. dt in seconds. force: check now (e.g. still frames).
    update(target, dt, force) {
        if (!this.sets.length) return;
        this._timer += dt || 0;
        if (!force && this._timer < this.o.interval) return;
        this._timer = 0;
        this.stats.checks++;
        let vis = 0, lod = 0;
        for (let i = 0; i < this.sets.length; i++) { vis += this._check(this.sets[i], target.x, target.z); lod += this.sets[i].lodVisible; }
        this.stats.visible = vis; this.stats.lod = lod;
    }

    // pool of an instance from its live code: > 0 full pool slot + 1, < 0 LOD pool -(slot + 1), 0 hidden
    _poolOf(set, f, i) { return set.live[f] > 0 ? set.pools[set.variant[i]] : set.lodPools[set.variant[i]]; }

    _claim(set, f, i, cx, cz, lod) {
        const pool = lod ? set.lodPools[set.variant[i]] : set.pools[set.variant[i]];
        if (pool.live >= pool.cap) { this.stats.overflow++; return false; }
        const slot = pool.live++, a = slot * 16, l = i * 16, arr = pool.arr, L = set.local, so = set.so;
        // M = P * RotY(theta) * Scale(j): columns 0 and 2 rotate about the point's own up axis
        let c = 1, sn = 0, j = 1;
        if (so.randomRotation) { const th = hash01(cx, cz, i, so.seed) * 6.283185307; c = Math.cos(th); sn = Math.sin(th); }
        if (so.scaleJitter > 0) j = 1 + (hash01(cz, i, cx, so.seed + 7) * 2 - 1) * so.scaleJitter;
        for (let r = 0; r < 3; r++) {
            const c0 = L[l + r], c1 = L[l + 4 + r], c2 = L[l + 8 + r];
            arr[a + r] = (c0 * c - c2 * sn) * j;
            arr[a + 4 + r] = c1 * j;
            arr[a + 8 + r] = (c0 * sn + c2 * c) * j;
        }
        arr[a + 3] = 0; arr[a + 7] = 0; arr[a + 11] = 0;
        arr[a + 12] = L[l + 12] + cx * this.o.tileSize; arr[a + 13] = L[l + 13]; arr[a + 14] = L[l + 14] + cz * this.o.tileSize; arr[a + 15] = 1;
        pool.owner[slot] = f;
        set.live[f] = pool.sign * (slot + 1);
        if (slot < pool.dMin) pool.dMin = slot; if (slot > pool.dMax) pool.dMax = slot;
        pool.countDirty = true;
        return true;
    }

    _release(set, f, i) {
        const pool = this._poolOf(set, f, i), slot = Math.abs(set.live[f]) - 1, last = --pool.live;
        set.live[f] = 0;
        if (slot !== last) {                            // move the last live instance into the hole
            const arr = pool.arr, a = slot * 16, b = last * 16;
            for (let e = 0; e < 16; e++) arr[a + e] = arr[b + e];
            const of = pool.owner[last]; pool.owner[slot] = of; set.live[of] = pool.sign * (slot + 1);
            if (slot < pool.dMin) pool.dMin = slot; if (slot > pool.dMax) pool.dMax = slot;
        }
        pool.countDirty = true;
    }

    // full <-> LOD: copy the instance's matrix into the other pool (identical transform, no jump), then free the old
    // slot. Both changes land in the same upload, so no frame shows both or neither. Target pool full: keep as is.
    _swap(set, f, i, toLod) {
        const from = this._poolOf(set, f, i), to = toLod ? set.lodPools[set.variant[i]] : set.pools[set.variant[i]];
        if (to.live >= to.cap) { this.stats.overflow++; return false; }
        const src = (Math.abs(set.live[f]) - 1) * 16, slot = to.live++, a = slot * 16;
        for (let e = 0; e < 16; e++) to.arr[a + e] = from.arr[src + e];
        to.owner[slot] = f;
        if (slot < to.dMin) to.dMin = slot; if (slot > to.dMax) to.dMax = slot;
        to.countDirty = true;
        this._release(set, f, i);
        set.live[f] = to.sign * (slot + 1);
        this.stats.swaps++;
        return true;
    }

    _clearSlot(set, ws) {
        if (!set.slotLive[ws]) return;
        const N = set.N, fb = ws * N;
        for (let i = 0; i < N; i++) if (set.live[fb + i]) this._release(set, fb + i, i);
        set.slotLive[ws] = 0;
    }

    // Change the LOD distance / buffer at runtime (-1 = all full). Full pools keep their load-time size, so beyond
    // it the extra trees simply stay LOD (stats.overflow counts them).
    setLod(name, distance, buffer) {
        for (const st of this.sets) if (st.name === name && st.hasLod) {
            if (distance !== undefined) st.so.lodDistance = distance;
            if (buffer !== undefined) st.so.lodBuffer = buffer;
        }
        this._timer = this.o.interval;
    }

    _check(set, tx, tz) {
        const o = this.o, s = o.tileSize, half = s / 2, showR2 = o.spawnDistance * o.spawnDistance;
        const hideR = o.spawnDistance + o.buffer, hideR2 = hideR * hideR;
        const { N, px, pz, g, cs, start, idx, R, W, live, slotLive, slotCx, slotCz, pools, lodPools, so, variant } = set;
        const chance = so.chance, salt = so.seed + 101;
        // LOD band: full tree inside lodR, LOD beyond lodR + lodBuffer, in between keep the current pool
        const lodOn = set.hasLod && so.lodDistance >= 0, lodR = lodOn ? so.lodDistance : 0, lodR2 = lodR * lodR,
            lodH = lodR + (lodOn ? Math.max(0, so.lodBuffer) : 0), lodH2 = lodH * lodH;
        const ccx = Math.floor((tx + half) / s), ccz = Math.floor((tz + half) / s);
        // pass 1: free whole tiles first (window slots reused for new cells, tiles beyond the hide radius), so a
        // big jump (teleport / resize) never needs more than the pool capacity at once
        for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
            const cx = ccx + dx, cz = ccz + dz;
            const ws = (((cz % W) + W) % W) * W + (((cx % W) + W) % W);
            if (slotCx[ws] !== cx || slotCz[ws] !== cz) { this._clearSlot(set, ws); slotCx[ws] = cx; slotCz[ws] = cz; }
            const lx = tx - cx * s, lz = tz - cz * s;
            const ex = Math.max(Math.abs(lx) - half, 0), ez = Math.max(Math.abs(lz) - half, 0);
            if (ex * ex + ez * ez > hideR2) this._clearSlot(set, ws);
        }
        // pass 2: per point show / hide inside the tiles in range
        for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
            const cx = ccx + dx, cz = ccz + dz;
            const ws = (((cz % W) + W) % W) * W + (((cx % W) + W) % W), fb = ws * N;
            const lx = tx - cx * s, lz = tz - cz * s;      // tile-local target
            const ex = Math.max(Math.abs(lx) - half, 0), ez = Math.max(Math.abs(lz) - half, 0);
            if (ex * ex + ez * ez > hideR2) continue;
            let n = slotLive[ws];
            for (let bz = 0; bz < g; bz++) {
                const z0 = -half + bz * cs, ddz = lz < z0 ? z0 - lz : (lz > z0 + cs ? lz - z0 - cs : 0);
                const fz = Math.max(Math.abs(lz - z0), Math.abs(lz - z0 - cs));
                for (let bx = 0; bx < g; bx++) {
                    const b = bz * g + bx, i0 = start[b], i1 = start[b + 1];
                    if (i0 === i1) continue;
                    const x0 = -half + bx * cs, ddx = lx < x0 ? x0 - lx : (lx > x0 + cs ? lx - x0 - cs : 0);
                    const far = ddx * ddx + ddz * ddz > hideR2;              // whole bucket beyond the hide radius
                    const fx = Math.max(Math.abs(lx - x0), Math.abs(lx - x0 - cs));
                    const far2 = fx * fx + fz * fz;
                    const allIn = !far && far2 <= showR2;                     // whole bucket inside the show radius
                    const allNear = lodOn && far2 <= lodR2;                   // whole bucket inside the full-tree radius
                    const allLod = lodOn && ddx * ddx + ddz * ddz > lodH2;    // whole bucket beyond the LOD hide radius
                    for (let k = i0; k < i1; k++) {
                        const i = idx[k], f = fb + i, lc = live[f], cur = lc === 0 ? 0 : (lc > 0 ? 2 : 1);   // 0 hidden, 1 LOD, 2 full
                        let want = 0;
                        if (!far && (chance >= 1 || hash01(cx, cz, i, salt) < chance)) {
                            let d2 = -1;
                            if (allIn) want = 2;
                            else {
                                const qx = px[i] - lx, qz = pz[i] - lz; d2 = qx * qx + qz * qz;
                                want = d2 <= showR2 ? 2 : (d2 > hideR2 ? 0 : (cur ? 2 : 0));   // hysteresis band keeps state
                            }
                            if (want && lodOn && lodPools[variant[i]]) {
                                if (allLod) want = 1;
                                else if (!allNear) {
                                    if (d2 < 0) { const qx = px[i] - lx, qz = pz[i] - lz; d2 = qx * qx + qz * qz; }
                                    want = d2 <= lodR2 ? 2 : (d2 > lodH2 ? 1 : (cur === 2 ? 2 : 1));   // LOD hysteresis
                                }
                            }
                        }
                        if (want === cur) continue;
                        if (!want) { this._release(set, f, i); n--; }
                        else if (!cur) { if (this._claim(set, f, i, cx, cz, want === 1) || (want === 2 && lodPools[variant[i]] && this._claim(set, f, i, cx, cz, true))) n++; }
                        else this._swap(set, f, i, want === 1);
                    }
                }
            }
            slotLive[ws] = n;
        }
        // upload only the touched slot range; draw count = live count
        let total = 0, lodLive = 0;
        for (let pv = 0; pv < pools.length * 2; pv++) {
            const p = pv < pools.length ? pools[pv] : lodPools[pv - pools.length];
            if (!p) continue;
            total += p.live; if (p.sign < 0) lodLive += p.live;
            if (p.dMax >= p.dMin) {
                // three resets updateRange.count to -1 after uploading; if a range is still pending, merge with it
                const ur = p.attr.updateRange;
                let lo = p.dMin * 16, hi = (p.dMax + 1) * 16;
                if (ur.count !== -1) { lo = Math.min(lo, ur.offset); hi = Math.max(hi, ur.offset + ur.count); }
                ur.offset = lo; ur.count = hi - lo;
                p.attr.needsUpdate = true; this.stats.uploads++;
                p.dMin = EMPTY; p.dMax = -1;
            }
            if (p.countDirty) {
                p.countDirty = false;
                for (let k = 0; k < p.parts.length; k++) { p.parts[k].count = p.live; p.parts[k].visible = p.live > 0; }
            }
        }
        set.visible = total; set.lodVisible = lodLive;
        return total;
    }
}
