import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.117.1/build/three.module.js';

export class DynamicCameraController {
    constructor(camera, aircraftMesh, flightController, config = {}) {
        this.camera = camera;
        this.mesh = aircraftMesh;
        this.flight = flightController; 

        this.posLerp = 5.0;     
        this.lookLerp = config.lookLerp || 5.0; // Slowed down lookAhead vector tracking
        
        // NEW: Controls the lag speed of the camera's rotation/horizon banking
        // Lower values (e.g., 2.0 - 4.0) give a heavy, delayed cinematic feel.
        this.lookRotationLerp = config.lookRotationLerp || 1.5;   

        // --- CAMERA DISTANCE & HEIGHT CONTROLS ---
        this.baseOffset = config.baseOffset || new THREE.Vector3(0, 0, -2); 
        
        this.turnOffsetIntensity = 5.0; 
        this.zoomOutIntensity = 1.0;    
        this.lookAheadDistance = 50.0;   

        this.currentLookAt = new THREE.Vector3();
        this.isInitialized = false;
    }

    update(deltaTime) {
        if (!this.mesh || !this.flight || deltaTime <= 0) return;

        const roll = this.flight.currentRoll; 
        const turnMagnitude = Math.abs(roll); 
        const heading = this.flight.velocity.clone().normalize();

        const dynamicZ = this.baseOffset.z - (turnMagnitude * this.zoomOutIntensity);
        const dynamicX = this.baseOffset.x + (roll * this.turnOffsetIntensity);

        const idealLocalOffset = new THREE.Vector3(dynamicX, this.baseOffset.y, dynamicZ);
        const idealWorldPosition = idealLocalOffset.applyQuaternion(this.mesh.quaternion).add(this.mesh.position);
        const idealLookAt = this.mesh.position.clone().add(heading.multiplyScalar(this.lookAheadDistance));

        if (!this.isInitialized) {
            this.camera.position.copy(idealWorldPosition);
            this.currentLookAt.copy(idealLookAt);
            
            // Initial snap orientation setup
            this.camera.lookAt(this.currentLookAt);
            this.isInitialized = true;
        } else {
            // 1. Lerp position smoothly
            this.camera.position.lerp(idealWorldPosition, this.posLerp * deltaTime);
            
            // 2. Lerp the look-at target vector
            this.currentLookAt.lerp(idealLookAt, this.lookLerp * deltaTime);

            // 3. NEW CRITICAL ROTATION LERP:
            // Calculate what the ideal camera rotation matrix would be right now
            const targetRotationMatrix = new THREE.Matrix4();
            
            // Up vector matches the aircraft world up, allowing the camera to follow the bank roll
            const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.mesh.quaternion);
            targetRotationMatrix.lookAt(this.camera.position, this.currentLookAt, cameraUp);

            // Convert that target orientation matrix into a Quaternion target
            const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(targetRotationMatrix);

            // Slerp (Spherical Linear Interpolation) smoothly blends the camera's 
            // current rotation toward the target rotation using our custom speed multiplier
            this.camera.quaternion.slerp(targetQuaternion, this.lookRotationLerp * deltaTime);
        }
    }
}