import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.117.1/build/three.module.js';

export class FlightController {
    constructor(aircraftMesh, config = {}) {
        this.mesh = aircraftMesh;

        // --- Flight Boundaries ---
        this.bounds = {
            minX: config.minX || -20000,
            maxX: config.maxX || 20000,
            minZ: config.minZ || -20000,
            maxZ: config.maxZ || 20000,
            minY: config.minY || 30,    // Hard floor
            maxY: config.maxY || 1000    // Flight ceiling
        };

        this.speed = config.baseSpeed || 50.0; 
        
        // Lower turn speed forces wider, more realistic aircraft banking arcs
        this.turnSpeed = config.turnSpeed || 30.8; 
        
        this.climbRate = config.climbRate || 0.6; // Flattens climbs
        this.diveRate = config.diveRate || 1.2;   // Steepens dives

        // --- Navigation Variables ---
        this.velocity = new THREE.Vector3(0, 0, this.speed);
        this.targetDirection = new THREE.Vector3(0, 0, 1);
        this.targetWaypoint = new THREE.Vector3();
        
        this.waypointTimer = 0;
        this.waypointTimerMax = 5;
        this.waypointTimerMin = 5;
        this.maxWaypointTime = 15.0; // Seconds allowed before forcing a new point
        this.arrivalThreshold = 60.0; // Distance considered "arrived"
        
        this.currentRoll = 0;

        // Pick the very first destination point immediately
        this.pickNewWaypoint();
    }

    pickNewWaypoint() {
        let valid = false;
        let attempts = 0;

        while (!valid && attempts < 10) {
            // 1. Pick a random distance far away from the aircraft (400 to 1000 units)
            const distance = 400 + Math.random() * 600;
            
            // 2. Generate a random spherical direction
            const theta = Math.random() * Math.PI * 2; // 360-degree Yaw

            // Limit Pitch to avoid picking points directly above/below the plane (realistic flight)
            // Pi/2 is horizon. We vary it by roughly +/- 30 degrees.
            const phi = (Math.PI / 2) + ((Math.random() - 0.5) * (Math.PI / 3)); 
            
            // Convert spherical to Cartesian coordinates
            const offsetX = distance * Math.sin(phi) * Math.cos(theta);
            const offsetY = distance * Math.cos(phi);
            const offsetZ = distance * Math.sin(phi) * Math.sin(theta);
            
            let targetX = this.mesh.position.x + offsetX;
            let targetY = this.mesh.position.y + offsetY;
            let targetZ = this.mesh.position.z + offsetZ;
            
            // 3. Clamp the new waypoint so it never exceeds the world boundaries
            targetX = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, targetX));
            targetY = Math.max(this.bounds.minY, Math.min(this.bounds.maxY, targetY));
            targetZ = Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, targetZ));
            
            this.targetWaypoint.set(targetX, targetY, targetZ);
            
            // Ensure the clamped point didn't accidentally end up too close to the plane
            if (this.mesh.position.distanceTo(this.targetWaypoint) > this.arrivalThreshold) {
                valid = true;
            }
            attempts++;
        }

        // Reset the navigation timer and assign a random max time to reach it (10 to 25 seconds)
        this.waypointTimer = 0;
        this.maxWaypointTime = this.waypointTimerMin + Math.random() * this.waypointTimerMax;
    }

    update(deltaTime) {
        if (!this.mesh || deltaTime <= 0) return;

        // 1. --- WAYPOINT NAVIGATION LOGIC ---
        this.waypointTimer += deltaTime;
        const distToWaypoint = this.mesh.position.distanceTo(this.targetWaypoint);

        // Check if we arrived, OR if we ran out of time
        if (distToWaypoint < this.arrivalThreshold || this.waypointTimer > this.maxWaypointTime) {
            this.pickNewWaypoint();
        }

        // Calculate the ideal direction pointing straight at the active waypoint
        this.targetDirection.subVectors(this.targetWaypoint, this.mesh.position).normalize();

        // 2. --- VELOCITY & AERODYNAMIC BIAS ---
        // Smoothly rotate the current velocity vector towards the target direction
        this.velocity.lerp(this.targetDirection, this.turnSpeed * deltaTime);
        this.velocity.normalize();

        // Apply climb/dive biases to alter pitch steepness naturally
        if (this.velocity.y > 0) {
            this.velocity.y *= this.climbRate; 
        } else {
            this.velocity.y *= this.diveRate;  
        }
        
        // Finalize the speed for this frame
        this.velocity.normalize().multiplyScalar(this.speed);

        // 3. --- TRANSLATE POSITION ---
        this.mesh.position.addScaledVector(this.velocity, deltaTime);

        // 4. --- NATURAL PITCH & YAW ---
        // lookAt inherently handles all Pitch (X) and Yaw (Y) perfectly based on velocity trajectory
        const lookTarget = new THREE.Vector3().copy(this.mesh.position).add(this.velocity);
        this.mesh.lookAt(lookTarget);

        // 5. --- BANKING PHYSICS (Procedural Roll) ---
        // Check how hard the target direction pulls to the left or right wing
        const rightVector = new THREE.Vector3(1, 0, 0).applyQuaternion(this.mesh.quaternion);
        const turnForce = this.targetDirection.dot(rightVector);
        
        // Negative sign forces the plane to bank *into* the turn. 
        // A multiplier of 2.5 sets the tilt intensity limit.
        const targetRoll = -turnForce * 0.5; 

        // Smoothly lerp current roll so wings level out naturally when flying straight
        this.currentRoll += (targetRoll - this.currentRoll) * 0.5 * deltaTime;

        // Apply localized roll (Z-axis rotation)
        this.mesh.rotateZ(this.currentRoll * 2);
    }
}