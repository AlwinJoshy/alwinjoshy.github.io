import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.117.1/build/three.module.js';

// Calm chase camera for the hero scene.
// - Offsets are smoothed in the plane's frame (no speed-induced lag, no jerks): exponential damping, frame-rate independent.
// - The aircraft is placed off-centre (right of the headline on landscape, low-centre on portrait) with
//   camera.setViewOffset, so the camera can simply look at the plane.
// - Very slow, subtle positional drift. Zero allocations per frame.
const _UP = new THREE.Vector3(0, 1, 0);
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
            narrowSide: 0                // portrait: lateral offset (narrow horizontal FOV: any side offset pushes the plane off-screen)
        }, opts);
        this.camera = camera; this.mesh = aircraft; this.flight = flight;
        this.fwd = new THREE.Vector3(0, 0, 1); this.off = new THREE.Vector3(); this.lookOff = new THREE.Vector3();
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
    }
}
