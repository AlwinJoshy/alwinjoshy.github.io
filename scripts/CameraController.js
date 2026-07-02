import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.117.1/build/three.module.js';

export class DynamicCameraController {
    constructor(camera, aircraftMesh, flightController, config = {}) {
        this.camera = camera;
        this.mesh = aircraftMesh;
        this.flight = flightController; 

        this.posLerp = config.posLerp || 3.0;     
        this.lookLerp = config.lookLerp || 50.0;   

        // --- CAMERA DISTANCE & HEIGHT CONTROLS ---
        // X = Left/Right alignment (0 is centered)
        // Y = Height above the plane (Lowered to 4 for a closer tail view)
        // Z = Distance behind the plane (Changed from -35 to -15 to bring it much closer)
        this.baseOffset = config.baseOffset || new THREE.Vector3(0, 0, -2); 
        
        this.turnOffsetIntensity = 20.0; 
        this.zoomOutIntensity = 1.0;    
        this.lookAheadDistance = 6.0;   

        this.currentLookAt = new THREE.Vector3();
        this.isInitialized = false;
    }

    update(deltaTime) {
        if (!this.mesh || !this.flight) return;

        const roll = this.flight.currentRoll; 
        const turnMagnitude = Math.abs(roll); 
        const heading = this.flight.velocity.clone().normalize();

        const dynamicZ = this.baseOffset.z - (turnMagnitude * this.zoomOutIntensity);

        // --- REVERSED SWING DIRECTION ---
        // Changed the minus sign to a plus sign (+). 
        // Now when the plane banks right (negative roll), this subtracts from X, pushing the camera Left.
        const dynamicX = this.baseOffset.x + (roll * this.turnOffsetIntensity);

        const idealLocalOffset = new THREE.Vector3(dynamicX, this.baseOffset.y, dynamicZ);

        const idealWorldPosition = idealLocalOffset.applyQuaternion(this.mesh.quaternion).add(this.mesh.position);

        const idealLookAt = this.mesh.position.clone().add(heading.multiplyScalar(this.lookAheadDistance));

        if (!this.isInitialized) {
            this.camera.position.copy(idealWorldPosition);
            this.currentLookAt.copy(idealLookAt);
            this.isInitialized = true;
        } else {
            this.camera.position.lerp(idealWorldPosition, this.posLerp * deltaTime);
            this.currentLookAt.lerp(idealLookAt, this.lookLerp * deltaTime);
        }

        this.camera.lookAt(this.currentLookAt);
    }
}