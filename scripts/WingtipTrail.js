import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.117.1/build/three.module.js';

/**
 * Lightweight wingtip vapour trail.
 * - Fixed-size ring buffer of world-space points sampled by distance travelled, so the
 *   ribbon follows the curved flight path at any frame rate.
 * - The newest point is snapped to the wingtip every frame (after the flight update),
 *   so the ribbon stays attached to the wing.
 * - Camera-facing ribbon that tapers and fades toward the tail.
 * - No allocation per frame: all buffers and scratch vectors are created once.
 */
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _toCam = new THREE.Vector3();
const _side = new THREE.Vector3();
const _eye = new THREE.Vector3();

export class WingtipTrail {
    constructor(scene, target, options = {}) {
        this.target = target;
        this.maxPoints = options.maxPoints || 40;
        this.segmentLength = options.segmentLength || 1.5;   // metres between samples
        this.width = options.width || 0.18;                   // half width at the wingtip
        this.count = 0;
        this.head = 0;                                        // ring index of newest point

        this.points = new Float32Array(this.maxPoints * 3);   // ring buffer (world space)

        const n = this.maxPoints;
        const positions = new Float32Array(n * 2 * 3);
        const along = new Float32Array(n * 2);                 // 0 at wingtip -> 1 at tail
        const side = new Float32Array(n * 2);                  // -1 / +1
        for (let i = 0; i < n; i++) {
            along[i * 2] = along[i * 2 + 1] = i / (n - 1);
            side[i * 2] = -1;
            side[i * 2 + 1] = 1;
        }
        const index = new Uint16Array((n - 1) * 6);
        for (let i = 0; i < n - 1; i++) {
            const v = i * 2;
            index.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
        }

        const geometry = new THREE.BufferGeometry();
        this.positionAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('position', this.positionAttr);
        geometry.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
        geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
        geometry.setIndex(new THREE.BufferAttribute(index, 1));
        geometry.setDrawRange(0, 0);

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: new THREE.Color(options.color ?? 0xffffff) },
                uOpacity: { value: 0 },
            },
            vertexShader: /* glsl */`
                attribute float aAlong;
                attribute float aSide;
                varying float vAlong;
                varying float vSide;
                void main() {
                    vAlong = aAlong;
                    vSide = aSide;
                    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
                }`,
            fragmentShader: /* glsl */`
                uniform vec3 uColor;
                uniform float uOpacity;
                varying float vAlong;
                varying float vSide;
                void main() {
                    float tail = 1.0 - clamp(vAlong, 0.0, 1.0);
                    float edge = 1.0 - vSide * vSide;           // soft ribbon edges
                    float a = uOpacity * tail * tail * edge;
                    if (a < 0.003) discard;
                    gl_FragColor = vec4(uColor, a);
                }`,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.NormalBlending,
            side: THREE.DoubleSide,
            fog: false,
            toneMapped: false,
        });

        this.mesh = new THREE.Mesh(geometry, this.material);
        this.mesh.frustumCulled = false;   // vertices are written in world space
        this.mesh.matrixAutoUpdate = false;
        this.mesh.renderOrder = 10;
        scene.add(this.mesh);
    }

    set opacity(v) { this.material.uniforms.uOpacity.value = v; }

    _point(i, out) {      // i = 0 newest .. count-1 oldest
        const r = ((this.head - i) % this.maxPoints + this.maxPoints) % this.maxPoints;
        return out.fromArray(this.points, r * 3);
    }

    reset() { this.count = 0; }

    update(camera) {
        this.target.updateWorldMatrix(true, false);   // fresh wingtip transform (not last frame's)
        this.target.getWorldPosition(_a);

        if (this.count === 0) {
            this.head = 0;
            _a.toArray(this.points, 0);
            _a.toArray(this.points, 3);
            this.head = 1;
            this.count = 2;
        } else {
            // Point 1 is the last committed sample; commit a new one every segmentLength.
            this._point(1, _b);
            if (_a.distanceToSquared(_b) >= this.segmentLength * this.segmentLength) {
                this.head = (this.head + 1) % this.maxPoints;
                if (this.count < this.maxPoints) this.count++;
            }
            // Newest point always sits exactly on the wingtip
            _a.toArray(this.points, this.head * 3);
        }

        this.buildRibbon(camera);
    }

buildRibbon(camera) {
        const pos = this.positionAttr.array;
        const n = this.count;
        _eye.setFromMatrixPosition(camera.matrixWorld);

        for (let i = 0; i < n; i++) {
            this._point(i, _a);
            // Tangent from neighbours
            const prev = Math.max(i - 1, 0), next = Math.min(i + 1, n - 1);
            this._point(prev, _tan);
            this._point(next, _b);
            _tan.sub(_b);
            if (_tan.lengthSq() < 1e-8) _tan.set(0, 0, 1);
            _toCam.subVectors(_eye, _a);
            _side.crossVectors(_tan, _toCam);
            const len = _side.length();
            if (len > 1e-6) _side.multiplyScalar(1 / len); else _side.set(1, 0, 0);

            const t = i / (this.maxPoints - 1);                 // 0 at wingtip, 1 at tail
            const grow = Math.min(t / 0.25, 1);                 // widen over first 25%
            const w = this.width * (0.03 + 0.97 * grow * grow); // thin at the tip
            const o = i * 6;
            pos[o] = _a.x - _side.x * w; pos[o + 1] = _a.y - _side.y * w; pos[o + 2] = _a.z - _side.z * w;
            pos[o + 3] = _a.x + _side.x * w; pos[o + 4] = _a.y + _side.y * w; pos[o + 5] = _a.z + _side.z * w;
        }

        this.positionAttr.updateRange.offset = 0;   // r117 API
        this.positionAttr.updateRange.count = n * 6;
        this.positionAttr.needsUpdate = true;
        this.mesh.geometry.setDrawRange(0, Math.max(0, n - 1) * 6);
    }
}
