import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.117.1/build/three.module.js';

// Natural, continuous flight: no waypoints or timers.
// Turn rate and altitude drift with smooth layered noise, the bank angle follows
// the turn like a real coordinated turn, and the plane steers gently back
// toward the centre near the edges of the world.

const _tmp = new THREE.Vector3();
const _look = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function makeNoise() {
    // A sum of sines with random phases and incommensurate frequencies gives a smooth, non-repeating signal
    const p = [Math.random() * 100, Math.random() * 100, Math.random() * 100];
    return (t) => (Math.sin(t * 0.071 + p[0]) * 0.55 +
                   Math.sin(t * 0.173 + p[1]) * 0.30 +
                   Math.sin(t * 0.379 + p[2]) * 0.15); // range about -1..1
}

export class FlightController {
    constructor(aircraftMesh, config = {}) {
        this.mesh = aircraftMesh;

        const lo = config.minY ?? 150, hi = config.maxY ?? 600;
        this.bounds = {
            minX: config.minX ?? -20000, maxX: config.maxX ?? 20000,
            minZ: config.minZ ?? -20000, maxZ: config.maxZ ?? 20000,
            minY: Math.min(lo, hi), maxY: Math.max(lo, hi)   // tolerate swapped values
        };

        this.speed = config.baseSpeed ?? 50.0;
        this.maxTurnRate = config.maxTurnRate ?? 0.35;   // rad/s of heading change (~20 deg/s)
        this.turnResponse = config.turnResponse ?? 0.8;  // how quickly the turn rate eases in and out
        this.maxClimb = config.maxClimb ?? 0.18;         // max pitch, in radians
        this.edgeMargin = config.edgeMargin ?? 3000;     // start turning home this far from the edge
        this.timeScale = config.timeScale ?? 1.0;        // > 1 makes it maneuver more often

        this.heading = Math.random() * Math.PI * 2;
        this.pitch = 0;
        this.turnRate = 0;
        this.bank = 0;
        this.currentRoll = 0;   // kept for the camera and trails (old scale: bank / 3)
        this.time = Math.random() * 1000;

        this.turnNoise = makeNoise();
        this.altNoise = makeNoise();

        this.velocity = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)).multiplyScalar(this.speed);
    }

    update(dt) {
        if (!this.mesh || dt <= 0) return;
        dt = Math.min(dt, 0.1);
        this.time += dt * this.timeScale;
        const pos = this.mesh.position;
        const b = this.bounds;

        // 1. Desired turn rate: smooth noise plus a gentle pull home near the edges
        let desiredTurn = this.turnNoise(this.time) * this.maxTurnRate;
        const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
        const edge = Math.max(
            (this.edgeMargin - Math.min(pos.x - b.minX, b.maxX - pos.x)) / this.edgeMargin,
            (this.edgeMargin - Math.min(pos.z - b.minZ, b.maxZ - pos.z)) / this.edgeMargin, 0);
        if (edge > 0) {
            const homeHeading = Math.atan2(cx - pos.x, cz - pos.z);
            let diff = homeHeading - this.heading;
            diff = Math.atan2(Math.sin(diff), Math.cos(diff));
            desiredTurn = THREE.MathUtils.lerp(desiredTurn, Math.sign(diff) * this.maxTurnRate, Math.min(edge, 1));
        }

        // 2. Ease the turn rate (no sudden direction changes)
        this.turnRate += (desiredTurn - this.turnRate) * Math.min(1, this.turnResponse * dt);
        this.heading += this.turnRate * dt;

        // 3. Altitude: drift smoothly between the bounds, then pitch toward it
        const midY = (b.minY + b.maxY) / 2, halfY = (b.maxY - b.minY) / 2;
        const targetY = midY + this.altNoise(this.time * 0.6) * halfY;
        const desiredPitch = THREE.MathUtils.clamp((targetY - pos.y) * 0.004, -this.maxClimb, this.maxClimb);
        this.pitch += (desiredPitch - this.pitch) * Math.min(1, 0.6 * dt);

        // 4. Move
        const cp = Math.cos(this.pitch);
        this.velocity.set(Math.sin(this.heading) * cp, Math.sin(this.pitch), Math.cos(this.heading) * cp)
            .multiplyScalar(this.speed);
        pos.addScaledVector(this.velocity, dt);
        pos.y = THREE.MathUtils.clamp(pos.y, b.minY - 50, b.maxY + 50);

        // 5. Orientation: face the velocity, then bank like a coordinated turn
        _look.copy(pos).add(this.velocity);
        this.mesh.up.copy(_up);
        this.mesh.lookAt(_look);
        const targetBank = -Math.atan((this.speed * this.turnRate) / 9.81);
        this.bank += (targetBank - this.bank) * Math.min(1, 2.0 * dt);
        this.mesh.rotateZ(this.bank);
        this.currentRoll = this.bank / 3;
    }
}
