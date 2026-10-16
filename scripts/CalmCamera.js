import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.117.1/build/three.module.js';

// Calm chase camera for the hero scene.
// - Offsets are smoothed in the plane's frame (no speed-induced lag, no jerks): exponential damping, frame-rate independent.
// - The aircraft is placed off-centre (right of the headline on landscape, low-centre on portrait) with
//   camera.setViewOffset, so the camera can simply look at the plane.
// - Very slow, subtle positional drift. Zero allocations per frame.
const _UP = new THREE.Vector3(0, 1, 0);
const _shakeE = new THREE.Euler(0, 0, 0, 'YXZ'), _shakeQ = new THREE.Quaternion();
// smooth pseudo-noise: sum of 3 incommensurate sines (C-infinity smooth, no allocations, ~free)
function sn(t, s) { return (Math.sin(t * 1.0 + s) * 0.5 + Math.sin(t * 2.31 + s * 1.7) * 0.3 + Math.sin(t * 4.13 + s * 2.9) * 0.2); }
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _ideal = new THREE.Vector3(), _look = new THREE.Vector3();

export class CalmCamera {
    constructor(camera, aircraft, flight, opts = {}) {
        this.o = Object.assign({
            distance: 12,        // behind the plane
            height: 5.4,         // above the plane
            side: -2.5,           // lateral offset (+ = to the plane's right)
            lookAhead: 10,        // look slightly ahead of the nose
            posDamp: 1.4,        // 1/s: how fast the offset follows heading changes (lower = lazier swing)
            lookDamp: 2.2,
            rollFactor: 0.18,    // share of the plane's bank applied to the horizon
            rollDamp: 1.0,
            drift: 0.9, driftSpeed: 0.11, // very slow positional drift (units, rad/s)
            frame: [0.68, 0.5],          // landscape: plane at x 68%, y 50% (from top) = right of the headline
            frameNarrow: [0.5, 0.56],     // portrait / narrow: below the headline (the plane renders ~10% below this point because the camera looks ahead of it)
            narrowScale: 0.62,           // portrait: distance/height/lookAhead multiplier (closer = bigger plane on phones)
            narrowSide: 0,
            // Wind shake / buffeting (applied after lookAt as small rotation + positional jitter; framing via setViewOffset unaffected)
            shakeEnabled: true,
            shake: 5.0,          // overall amplitude multiplier (1 = subtle; 0 = off)
            shakeFreq: 1.0,      // time-scale multiplier for all layers
            gustStrength: 1.5,   // 0..1 how much the slow gust envelope boosts amplitude
            bankShake: 1.5       // extra amplitude per radian of bank (turns feel bumpier)                // portrait: lateral offset (narrow horizontal FOV: any side offset pushes the plane off-screen)
        }, opts);
        this.camera = camera; this.mesh = aircraft; this.flight = flight;
        this.fwd = new THREE.Vector3(0, 0, 1); this.off = new THREE.Vector3(); this.lookOff = new THREE.Vector3();
        this.st = Math.random() * 1000;
        const rm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
        this.reduceMotion = !!(rm && rm.matches);
        if (rm && rm.addEventListener) rm.addEventListener('change', (e) => { this.reduceMotion = e.matches; });
        this.k = 1; this.side = this.o.side; this.roll = 0; this.t = Math.random() * 100; this.init = false;
    }

    // Call on resize: puts the look target at the configured screen point.
    setFrame(w, h) {
        const narrow = w / h < 1, f = narrow ? this.o.frameNarrow : this.o.frame;
        this.k = narrow ? this.o.narrowScale : 1; this.side = narrow ? this.o.narrowSide : this.o.side;
        this.camera.setViewOffset(w, h, (0.5 - f[0]) * w, (0.5 - f[1]) * h, w, h);
    }

    update(dt) {
        if (!this.mesh || !this.flight || dt <= 0) return;
        const o = this.o, p = this.mesh.position, v = this.flight.velocity;
        this.t += dt;
        _f.set(v.x, 0, v.z); if (_f.lengthSq() < 1e-6) _f.set(0, 0, 1); _f.normalize();
        const kp = 1 - Math.exp(-o.posDamp * dt), kl = 1 - Math.exp(-o.lookDamp * dt);
        this.fwd.lerp(_f, this.init ? kp : 1).normalize();       // lazily smoothed heading
        _r.crossVectors(this.fwd, _UP);                           // right
        const dx = Math.sin(this.t * o.driftSpeed) * o.drift, dy = Math.sin(this.t * o.driftSpeed * 0.73 + 1.3) * o.drift * 0.6;
        const k = this.k;
        _ideal.copy(this.fwd).multiplyScalar(-o.distance * k).addScaledVector(_r, this.side + dx * k);
        _ideal.y += (o.height + dy) * k;
        _look.copy(v).normalize().multiplyScalar(o.lookAhead * k);
        if (!this.init) { this.off.copy(_ideal); this.lookOff.copy(_look); this.init = true; }
        else { this.off.lerp(_ideal, kp); this.lookOff.lerp(_look, kl); }
        const bank = this.flight.bank || 0;
        this.roll += (bank * o.rollFactor - this.roll) * (1 - Math.exp(-o.rollDamp * dt));
        const cam = this.camera;
        cam.position.copy(p).add(this.off);
        _look.copy(p).add(this.lookOff);
        cam.up.copy(_UP).addScaledVector(_r, -Math.sin(this.roll)).normalize();
        cam.lookAt(_look);
        if (o.shakeEnabled && o.shake > 0 && !this.reduceMotion) this.applyShake(dt, bank);
    }

    // Layered wind: slow sway (~0.1-0.3 Hz) + light buffet (~1.5-4 Hz), both scaled by a slow gust envelope.
    applyShake(dt, bank) {
        const o = this.o, t = (this.st += dt * o.shakeFreq);
        const g = Math.max(0, sn(t * 0.07, 11.0));                  // 0..~1, slow gusts every ~30-60 s
        const gust = 1 + o.gustStrength * g * g * 2.0;
        const amp = o.shake * gust * (1 + o.bankShake * Math.min(Math.abs(bank), 1.2));
        const sway = 0.004, buf = 0.0012 * (0.4 + g);               // radians; buffet grows strongly inside gusts
        _shakeE.set(
            (sn(t * 0.21, 1.3) * sway + sn(t * 2.7, 4.1) * buf) * amp,        // pitch
            (sn(t * 0.17, 2.7) * sway + sn(t * 2.3, 7.9) * buf) * amp,        // yaw
            (sn(t * 0.13, 5.2) * sway * 1.4 + sn(t * 3.1, 9.4) * buf) * amp   // roll
        );
        this.camera.quaternion.multiply(_shakeQ.setFromEuler(_shakeE));
        const p = 0.05 * amp * this.k;                                    // tiny positional bob (units)
        this.camera.position.x += sn(t * 0.9, 3.3) * p;
        this.camera.position.y += sn(t * 1.1, 6.6) * p;
        this.camera.position.z += sn(t * 0.8, 8.8) * p;
    }
}
