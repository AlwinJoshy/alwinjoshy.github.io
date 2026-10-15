import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.117.1/build/three.module.js';

// Enemy fighters that chase the player and fire tracers.
// Zero allocations per frame: all vectors are preallocated, tracers are one InstancedMesh pool,
// hit sparks are one Points pool.
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(1, 1, 1);
const _Z = new THREE.Vector3(0, 0, 1), _UP = new THREE.Vector3(0, 1, 0);

export class Dogfight {
    constructor(scene, player, enemyTemplate, opts = {}) {
        const o = Object.assign({
            count: 3,
            tint: 0x5a5f52,          // multiplied into the cloned body material colour
            speed: 58,               // cruise speed (player flies ~50)
            
            turnRate: 1.3,           // rad/s max heading change
            maxBank: 1.1,            // rad
            followDist: 70,          // slot distance behind player
            sideSpread: 35,          // lateral slot spacing
            separation: 25,          // min distance between enemies
            minY: 55, maxY: 280,
            fireCone: 8,             // degrees
            range: 380,
            fireRate: 14,            // rounds/s per enemy while firing
            burst: 1.2, burstCooldown: 1.6,
            bulletSpeed: 420, bulletLife: 1.5, maxBullets: 200,
            spread: 0.012,           // rad of random dispersion
            tracerColor: 0xffb347, tracerLength: 9, tracerWidth: 3.2, // width holds the soft halo
            playerTracerColor: 0xfff1c0, // slightly whiter player rounds
            // player AI (needs opts.playerController = FlightController); null = player keeps wandering
            playerController: null,
            evadeTime: [3.0, 5.0],   // s, random range per evade phase
            lostTargetTime: [1.0, 3.0], // s: attack ends only after no valid target for this long (random per phase)
            searchRange: 600,        // player target search distance
            searchCone: 80,          // degrees half-angle of the player's search view
            playerTurnRate: 0.95,    // rad/s max commanded turn (bank comes from FlightController.maxBank)
            playerFireCone: 6,       // degrees
            playerFireRate: 16, playerBurst: 0.5, playerBurstCooldown: 0.45,
            enemyHP: 7,              // hits to down an enemy
            hitRadius: 4, maxSparks: 64,
            enemySpeedFactor: 0.7,   // enemy cruise = factor x player speed (FlightController.speed if given)
            respawnDist: 700,        // respawn when farther than this...
            respawnBehind: 420,      // ...or this far behind the player
            respawnAhead: 320, respawnSpread: 70
        }, opts);
        this.o = o; this.scene = scene; this.player = player;
        this._pPrev = player.position.clone(); this._pVel = new THREE.Vector3(0, 0, o.speed);
        this._pFwd = new THREE.Vector3(0, 0, 1);

        // shared tinted materials for all enemies (one clone per source material)
        const matMap = new Map();
        this._mats = [];
        const tint = new THREE.Color(o.tint);
        const tintMat = (m) => {
            if (matMap.has(m)) return matMap.get(m);
            let c = m;
            if (!m.isShaderMaterial) { c = m.clone(); if (c.color) c.color.multiply(tint); this._mats.push(c); }
            matMap.set(m, c); return c;
        };
        this.enemies = [];
        for (let i = 0; i < o.count; i++) {
            const mesh = enemyTemplate.clone(true);
            mesh.traverse((ch) => { if (ch.isMesh) ch.material = Array.isArray(ch.material) ? ch.material.map(tintMat) : tintMat(ch.material); });
            const side = (i - (o.count - 1) / 2) * o.sideSpread;
            const e = { mesh, vel: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, 1), speed: o.speed, roll: 0,
                slot: new THREE.Vector3(side, (i % 2 ? 8 : -6), -o.followDist - i * 18),
                cool: Math.random() * 2, burstT: 0, shotAcc: 0, gun: i % 2, hp: o.enemyHP, jink: Math.random() * 6 };
            scene.add(mesh);
            this.enemies.push(e);
            this._respawn(e, i);
        }

        // tracer pool
        // stretched camera-facing quads (axis = bullet velocity), procedural streak texture, additive
        const g = new THREE.PlaneBufferGeometry(1, 1);
        this.tracerTex = makeTracerTexture();
        this.tracerMat = new THREE.ShaderMaterial({
            uniforms: { uMap: { value: this.tracerTex }, uLen: { value: o.tracerLength }, uWid: { value: o.tracerWidth },
                uCol: { value: new THREE.Color(o.tracerColor) }, uColP: { value: new THREE.Color(o.playerTracerColor) } },
            vertexShader: TRACER_VS, fragmentShader: TRACER_FS,
            blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide });
        this.tracers = new THREE.InstancedMesh(g, this.tracerMat, o.maxBullets);
        this.tracers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.tracers.count = 0; this.tracers.frustumCulled = false;
        scene.add(this.tracers);
        const N = o.maxBullets;
        this.bPos = new Float32Array(N * 3); this.bVel = new Float32Array(N * 3); this.bLife = new Float32Array(N); this.bOwn = new Uint8Array(N);
        this.nB = 0;

        // spark pool
        const S = o.maxSparks;
        this.sPos = new Float32Array(S * 3); this.sCol = new Float32Array(S * 3); this.sVel = new Float32Array(S * 3); this.sLife = new Float32Array(S);
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3).setUsage(THREE.DynamicDrawUsage));
        sg.setAttribute('color', new THREE.BufferAttribute(this.sCol, 3).setUsage(THREE.DynamicDrawUsage));
        this.sparkMat = new THREE.PointsMaterial({ size: 1.6, vertexColors: true, blending: THREE.AdditiveBlending,
            transparent: true, depthWrite: false, toneMapped: false, fog: false });
        this.sparks = new THREE.Points(sg, this.sparkMat); this.sparks.frustumCulled = false;
        scene.add(this.sparks); this.sNext = 0;
        this._cosCone = Math.cos(THREE.MathUtils.degToRad(o.fireCone));
        this._cosPCone = Math.cos(THREE.MathUtils.degToRad(o.playerFireCone));
        // player state machine
        this.pc = o.playerController;
        this.phase = 'evade'; this.phaseT = rr(o.evadeTime); this.breakDir = 1; this.breakT = 0;
        this.target = null; this.lostT = 0; this.lostLimit = 2; this.pBurst = 0; this.pCool = 0; this.pAcc = 0; this.pGun = 0; this.time = 0;
        this._cosSearch = Math.cos(THREE.MathUtils.degToRad(o.searchCone));
        this._pm = { position: player.position, quaternion: player.quaternion }; // shooter view of player
    }

    _validTarget(e) {
        _a.subVectors(e.mesh.position, this.player.position); const d = _a.length();
        return d < this.o.searchRange && _a.dot(this._pFwd) > this._cosSearch * d;
    }
    _findTarget() {
        let best = null, bd = 1e9;
        for (const e of this.enemies) { if (!this._validTarget(e)) continue; const d = e.mesh.position.distanceToSquared(this.player.position); if (d < bd) { bd = d; best = e; } }
        return best;
    }

    _baseSpeed() { return (this.pc ? this.pc.speed : this._pSpeed || 50) * this.o.enemySpeedFactor; }

    // Slower enemies respawn AHEAD of the player, flying toward it, so they always re-engage.
    _respawn(e, i) {
        const o = this.o, p = this.player.position, k = (i || 0) - 1;
        _c.crossVectors(_UP, this._pFwd).normalize();
        e.mesh.position.copy(p).addScaledVector(this._pFwd, o.respawnAhead + (i || 0) * 30).addScaledVector(_c, k * o.respawnSpread);
        e.mesh.position.y = THREE.MathUtils.clamp(p.y + k * 15, o.minY, o.maxY);
        e.fwd.copy(this._pFwd).negate(); e.speed = this._baseSpeed(); e.roll = 0; e.hp = o.enemyHP;
    }

    update(dt, camera) {
        if (dt <= 0) return;
        const o = this.o, p = this.player.position;
        // player velocity / heading from motion
        this._pVel.subVectors(p, this._pPrev).divideScalar(dt); this._pPrev.copy(p);
        const ps = this._pVel.length(); this._pSpeed = ps;
        if (ps > 1) this._pFwd.copy(this._pVel).divideScalar(ps);
        this.time += dt;
        if (this.pc) this._playerAI(dt);
        const right = _d.crossVectors(_UP, this._pFwd).normalize(); // player's left/right axis

        for (let i = 0; i < this.enemies.length; i++) {
            const e = this.enemies[i], pos = e.mesh.position;
            const toP = _a.subVectors(p, pos); const dist = toP.length();
            if (dist > o.respawnDist || (dist > o.respawnBehind && toP.dot(this._pFwd) > 0)) { this._respawn(e, i); continue; }
            // steering target: formation slot behind player, or lead-pursuit when close
            const tgt = _b;
            if (dist < o.range * 0.8) {
                const tof = dist / o.bulletSpeed;
                tgt.copy(p).addScaledVector(this._pVel, tof);
            } else {
                tgt.copy(p).addScaledVector(this._pFwd, e.slot.z).addScaledVector(right, e.slot.x); tgt.y += e.slot.y;
            }
            const des = tgt.sub(pos).normalize();
            // separation
            for (let j = 0; j < this.enemies.length; j++) {
                if (j === i) continue;
                _c.subVectors(pos, this.enemies[j].mesh.position); const dd = _c.length();
                if (dd < o.separation && dd > 0.001) des.addScaledVector(_c, (o.separation - dd) / (o.separation * dd) * 1.5);
            }
            // the enemy being hunted jinks side to side / up and down
            // player's attack phase: ALL enemies evade (break away + jink, no firing); else they attack
            const hunted = this.pc && this.phase === 'attack';
            if (hunted) {
                des.copy(toP).multiplyScalar(-1 / dist).multiplyScalar(0.5);
                des.addScaledVector(right, Math.sign(Math.sin(this.time * 0.9 + e.jink)) * 0.8 + Math.sin(this.time * 2.3 + e.jink) * 0.4);
                des.y += Math.sin(this.time * 1.3 + e.jink) * 0.45;
            }
            // don't ram the player
            if (dist < 20) des.addScaledVector(toP, -1.5 / dist);
            // altitude bounds
            if (pos.y < o.minY + 15) des.y += (o.minY + 15 - pos.y) * 0.05;
            else if (pos.y > o.maxY - 15) des.y -= (pos.y - o.maxY + 15) * 0.05;
            des.normalize();
            // limited turn rate
            const ang = Math.acos(THREE.MathUtils.clamp(e.fwd.dot(des), -1, 1));
            const maxA = o.turnRate * dt;
            // horizontal turn sign for banking
            const turnSign = e.fwd.x * des.z - e.fwd.z * des.x;
            if (ang > 1e-4) e.fwd.lerp(des, Math.min(1, maxA / ang)).normalize();
            const bankT = THREE.MathUtils.clamp(-turnSign * 6.0, -o.maxBank, o.maxBank);
            e.roll += (bankT - e.roll) * Math.min(1, 3 * dt);
            // speed: catch up when far, ease off when close
            const base = this._baseSpeed(), sT = THREE.MathUtils.clamp(base + (dist - o.followDist) * 0.05, base * 0.85, base * 1.15);
            e.speed += (sT - e.speed) * Math.min(1, dt);
            pos.addScaledVector(e.fwd, e.speed * dt);
            if (pos.y < o.minY) pos.y = o.minY;
            // orient: +Z forward (same convention as FlightController lookAt), then roll
            _c.copy(pos).add(e.fwd); e.mesh.lookAt(_c); e.mesh.rotateZ(e.roll);

            // firing
            e.cool -= dt;
            const aimDot = e.fwd.dot(toP) / dist;
            if (hunted) { e.burstT = 0; e.shotAcc = 0; }
            else if (e.burstT > 0) {
                e.burstT -= dt; e.shotAcc += dt * o.fireRate;
                while (e.shotAcc >= 1) { e.shotAcc -= 1; e.gun ^= 1; this._fire(e.mesh, e.fwd, e.speed, e.gun, 0); }
                if (e.burstT <= 0) e.cool = o.burstCooldown;
            } else if (e.cool <= 0 && dist < o.range && aimDot > this._cosCone) {
                e.burstT = o.burst; e.shotAcc = 1;
            }
        }
        this._updateBullets(dt);
        this._updateSparks(dt);
    }

    // shooter: {position, quaternion}; fwd: unit dir; speed: shooter speed; owner 0 = enemy, 1 = player
    _fire(m, fwd, speed, gun, owner) {
        if (this.nB >= this.o.maxBullets) return;
        const o = this.o, k = this.nB++;
        _c.set(gun ? 2.2 : -2.2, -0.2, 3).applyQuaternion(m.quaternion).add(m.position); // wing guns
        _a.copy(fwd);
        _a.x += (Math.random() - 0.5) * o.spread * 2; _a.y += (Math.random() - 0.5) * o.spread * 2; _a.z += (Math.random() - 0.5) * o.spread * 2;
        _a.normalize().multiplyScalar(o.bulletSpeed).addScaledVector(fwd, speed);
        this.bPos[k * 3] = _c.x; this.bPos[k * 3 + 1] = _c.y; this.bPos[k * 3 + 2] = _c.z;
        this.bVel[k * 3] = _a.x; this.bVel[k * 3 + 1] = _a.y; this.bVel[k * 3 + 2] = _a.z;
        this.bLife[k] = o.bulletLife; this.bOwn[k] = owner;
    }

    // Alternating phases: EVADE (hard breaks, climbs/dives) <-> ATTACK (swing round, line up, fire bursts).
    _playerAI(dt) {
        const o = this.o, st = this.pc.steer, p = this.player.position;
        st.active = true;
        if (this.phase === 'evade') {
            this.phaseT -= dt;
            if (this.phaseT <= 0) { this.phase = 'attack'; this.lostT = 0; this.lostLimit = rr(o.lostTargetTime); this.target = null; }
        } else {
            // attack lasts while a valid target (in range + in view) exists; keep current one if still valid
            if (!this.target || !this._validTarget(this.target)) this.target = this._findTarget();
            if (this.target) this.lostT = 0;
            else if ((this.lostT += dt) >= this.lostLimit) { this.phase = 'evade'; this.phaseT = rr(o.evadeTime); this.breakT = 0; }
        }
        if (this.phase === 'evade') {
            this.breakT -= dt;
            if (this.breakT <= 0) { // new break: hard turn one way, climb or dive
                this.breakDir = -this.breakDir; this.breakT = 1.2 + Math.random() * 1.3;
                st.y = p.y + (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 70);
            }
            st.turn = this.breakDir * o.playerTurnRate; st.response = 3.0; st.pitchResponse = 2.2;
            return;
        }
        // attack: pursue target with lead, fire when lined up
        let e = this.target;
        if (!e) { // searching: swing toward the nearest enemy, no firing
            let best = 1e9;
            for (const c of this.enemies) { const d = c.mesh.position.distanceToSquared(p); if (d < best) { best = d; e = c; } }
            if (!e) return;
        }
        const tp = e.mesh.position, dist = tp.distanceTo(p);
        _c.copy(tp).addScaledVector(e.fwd, e.speed * dist / o.bulletSpeed); // lead point
        const hdg = Math.atan2(_c.x - p.x, _c.z - p.z), cur = this.pc.heading;
        const diff = Math.atan2(Math.sin(hdg - cur), Math.cos(hdg - cur));
        st.turn = THREE.MathUtils.clamp(diff * 2.2, -o.playerTurnRate, o.playerTurnRate);
        st.response = 2.5; st.pitchResponse = 2.5; st.y = _c.y;
        this.pCool -= dt;
        if (this.pBurst > 0) {
            this.pBurst -= dt; this.pAcc += dt * o.playerFireRate;
            while (this.pAcc >= 1) { this.pAcc -= 1; this.pGun ^= 1; this._fire(this._pm, this._pFwd, this._pSpeed, this.pGun, 1); }
            if (this.pBurst <= 0) this.pCool = o.playerBurstCooldown;
        } else if (this.target && this.pCool <= 0 && dist < o.range) {
            _a.subVectors(_c, p).normalize();
            if (_a.dot(this._pFwd) > this._cosPCone) { this.pBurst = o.playerBurst; this.pAcc = 1; }
        }
    }

    _updateBullets(dt) {
        const P = this.bPos, V = this.bVel, L = this.bLife, p = this.player.position, hr2 = this.o.hitRadius * this.o.hitRadius;
        let i = 0;
        while (i < this.nB) {
            L[i] -= dt;
            const i3 = i * 3;
            P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
            let dead = L[i] <= 0;
            if (!dead && this.bOwn[i] === 0) {
                const dx = P[i3] - p.x, dy = P[i3 + 1] - p.y, dz = P[i3 + 2] - p.z;
                if (dx * dx + dy * dy + dz * dz < hr2) { this._spark(P[i3], P[i3 + 1], P[i3 + 2], 6); dead = true; }
            } else if (!dead) {
                for (let j = 0; j < this.enemies.length; j++) {
                    const e = this.enemies[j], q = e.mesh.position;
                    const dx = P[i3] - q.x, dy = P[i3 + 1] - q.y, dz = P[i3 + 2] - q.z;
                    if (dx * dx + dy * dy + dz * dz < hr2 * 1.6) {
                        this._spark(P[i3], P[i3 + 1], P[i3 + 2], 6); dead = true;
                        if (--e.hp <= 0) { this._spark(q.x, q.y, q.z, 24); if (this.target === e) this.target = null; this._respawn(e, j); }
                        break;
                    }
                }
            }
            if (dead) { // swap-remove
                const last = --this.nB, l3 = last * 3;
                P[i3] = P[l3]; P[i3 + 1] = P[l3 + 1]; P[i3 + 2] = P[l3 + 2];
                V[i3] = V[l3]; V[i3 + 1] = V[l3 + 1]; V[i3 + 2] = V[l3 + 2]; L[i] = L[last]; this.bOwn[i] = this.bOwn[last];
                continue;
            }
            _a.set(V[i3], V[i3 + 1], V[i3 + 2]).normalize();
            _q.setFromUnitVectors(_Z, _a);
            _b.set(P[i3], P[i3 + 1], P[i3 + 2]);
            _s.x = this.bOwn[i] ? 2 : 1; _m.compose(_b, _q, _s);
            this.tracers.setMatrixAt(i, _m);
            i++;
        }
        this.tracers.count = this.nB;
        this.tracers.instanceMatrix.needsUpdate = true;
    }

    _spark(x, y, z, count = 6) {
        const big = count > 6 ? 2.2 : 1;
        for (let n = 0; n < count; n++) {
            const k = this.sNext; this.sNext = (k + 1) % this.o.maxSparks; const k3 = k * 3;
            this.sPos[k3] = x; this.sPos[k3 + 1] = y; this.sPos[k3 + 2] = z;
            this.sVel[k3] = (Math.random() - 0.5) * 30 * big; this.sVel[k3 + 1] = (Math.random() - 0.5) * 30 * big; this.sVel[k3 + 2] = (Math.random() - 0.5) * 30 * big;
            this.sLife[k] = 0.35;
        }
    }

    _updateSparks(dt) {
        const S = this.o.maxSparks; let any = false;
        for (let k = 0; k < S; k++) {
            const k3 = k * 3;
            if (this.sLife[k] <= 0) { if (this.sCol[k3] !== 0) { this.sCol[k3] = this.sCol[k3 + 1] = this.sCol[k3 + 2] = 0; any = true; } continue; }
            this.sLife[k] -= dt; any = true;
            this.sPos[k3] += this.sVel[k3] * dt; this.sPos[k3 + 1] += this.sVel[k3 + 1] * dt; this.sPos[k3 + 2] += this.sVel[k3 + 2] * dt;
            const f = Math.max(0, this.sLife[k] / 0.35);
            this.sCol[k3] = f; this.sCol[k3 + 1] = f * 0.7; this.sCol[k3 + 2] = f * 0.3;
        }
        if (any) { const a = this.sparks.geometry.attributes; a.position.needsUpdate = true; a.color.needsUpdate = true; }
    }

    setVisible(v) { for (const e of this.enemies) e.mesh.visible = v; this.tracers.visible = v; this.sparks.visible = v; }

    dispose() {
        for (const e of this.enemies) this.scene.remove(e.mesh);
        this.scene.remove(this.tracers); this.scene.remove(this.sparks);
        this.tracers.geometry.dispose(); this.tracerMat.dispose(); this.tracerTex.dispose();
        if (this.pc) this.pc.steer.active = false;
        this.sparks.geometry.dispose(); this.sparkMat.dispose();
        for (const m of this._mats) m.dispose();
        this.enemies.length = 0;
    }
}

function rr(r) { return r[0] + Math.random() * (r[1] - r[0]); }

// Procedural lens-streak (64x128, symmetric): thin needle line tapering to both ends, white-hot centre spot,
// broad soft elliptical halo. r = tintable glow, a = white-hot core. No network cost.
function makeTracerTexture() {
    const W = 64, H = 128, d = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
        const v = ((y + 0.5) / H) * 2 - 1, taper = Math.max(0, 1 - Math.abs(v));
        for (let x = 0; x < W; x++) {
            const u = ((x + 0.5) / W) * 2 - 1;
            const lw = 0.015 + 0.05 * taper * taper;                     // needle half-width
            const line = Math.exp(-(u * u) / (lw * lw)) * Math.pow(taper, 0.8);
            const r2 = (u / 0.8) * (u / 0.8) + v * v;                     // elliptical halo
            const halo = Math.pow(Math.max(0, 1 - r2), 2.5) * 0.3 + Math.exp(-r2 * 6) * 0.25;
            const spot = Math.exp(-(u * u / 0.006 + v * v / 0.02));
            const g = Math.min(1, line + halo + spot * 0.6);
            const w = Math.min(1, spot + line * line * 0.6);
            const k = (y * W + x) * 4;
            d[k] = d[k + 1] = d[k + 2] = 255 * g; d[k + 3] = 255 * w;
        }
    }
    const t = new THREE.DataTexture(d, W, H, THREE.RGBAFormat);
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
    return t;
}

const TRACER_VS = /* glsl */`
uniform float uLen, uWid;
varying vec2 vUv; varying float vOwn;
void main() {
    vec3 c = instanceMatrix[3].xyz;
    vec3 dir = normalize(instanceMatrix[2].xyz);
    vOwn = step(1.5, length(instanceMatrix[0].xyz));
    vec3 toCam = normalize(cameraPosition - c);
    vec3 side = normalize(cross(dir, toCam));
    vec3 w = c + dir * (position.y * uLen) + side * (position.x * uWid * (1.0 + vOwn * 0.15));
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const TRACER_FS = /* glsl */`
uniform sampler2D uMap; uniform vec3 uCol, uColP;
varying vec2 vUv; varying float vOwn;
void main() {
    vec4 t = texture2D(uMap, vUv);           // rgb = glow mask, a = white-hot core
    vec3 col = mix(uCol, uColP, vOwn);
    gl_FragColor = vec4(col * t.r * 1.6 + vec3(1.0, 0.95, 0.85) * t.a, 1.0);
}`;
