import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.117.1/build/three.module.js';

export class DynamicCameraController {
    constructor(camera, aircraftMesh, flightController, config = {}) {
        this.camera = camera;
        this.mesh = aircraftMesh;
        this.flight = flightController; 

        // --- Core Physics Interpolation Speeds ---
        this.posLerp = config.posLerp || 3.5;       // Speed at which camera physically catches up to the plane
        this.lookLerp = config.lookLerp || 4.0;     // Lag speed of the focal look-ahead point
        this.rotationLerp = config.rotationLerp || 2.8; // Heavy cinematic lag for the camera's horizon tilt

        // --- Base Spatial Tuning ---
        // X = Horizontal center offset, Y = Height above plane cockpit, Z = Distance behind tail
        this.baseOffset = config.baseOffset || new THREE.Vector3(0, 1.2, -7.0); 
        
        // --- Dynamic Mechanics Parameters ---
        this.lookAheadDistance = 25.0; // How far in front of the nose the camera focuses
        this.turnCentrifugalDrag = 8.0; // How much the camera "swings wide" horizontally during tight banking
        this.turnCompressionZ = 4.0;    // How much G-force compresses the camera closer to the tail during turns
        this.pitchUpRiseY = 3.0;        // How much the camera sinks/rises when climbing or diving

        this.currentLookAt = new THREE.Vector3();
        this.isInitialized = false;
    }

    update(deltaTime) {
        if (!this.mesh || !this.flight || deltaTime <= 0) return;

        const roll = this.flight.currentRoll; // Negative value = Banking Right, Positive = Banking Left
        const forwardDirection = this.flight.velocity.clone().normalize();

        // 1. --- CALCULATE COMPOSITE SHIFT FACTOR (WORLD HORIZON COMPLIANT) ---
        // Compute structural offsets dynamically based on G-forces and velocity orientations
        const dynamicZOffset = this.baseOffset.z + (Math.abs(roll) * this.turnCompressionZ); 
        const dynamicXOffset = this.baseOffset.x - (roll * this.turnCentrifugalDrag);
        
        // Detect if climbing or diving using the world up direction vector projection
        const verticalPitchStrength = forwardDirection.dot(new THREE.Vector3(0, 1, 0)); 
        const dynamicYOffset = this.baseOffset.y - (verticalPitchStrength * this.pitchUpRiseY);

        // 2. --- ESTABLISH THE IDEAL FOLLOW POSITION (IN WORLD COORDINATES) ---
        // We find the flat directional tracking footprint along the ground to prevent wing tilting from pushing us into the sky
        const flatForward = new THREE.Vector3(forwardDirection.x, 0, forwardDirection.z).normalize();
        const worldRight = new THREE.Vector3(0, 1, 0).cross(flatForward).normalize();
        
        const idealWorldPosition = this.mesh.position.clone()
            .addScaledVector(flatForward, dynamicZOffset)  // Backwards trail anchor
            .addScaledVector(worldRight, dynamicXOffset)    // Wide centrifugal side drift
            .add(new THREE.Vector3(0, dynamicYOffset, 0)); // Pure altitude height stabilization

        // 3. --- COMPUTE DYNAMIC LOOK-AHEAD TARGET ---
        // Instead of targeting the plane, focus deep along its forward vector path trajectory
        const idealLookAt = this.mesh.position.clone().addScaledVector(forwardDirection, this.lookAheadDistance);

        // 4. --- FIRST-FRAME INITIALIZATION LOCK ---
        if (!this.isInitialized) {
            this.camera.position.copy(idealWorldPosition);
            this.currentLookAt.copy(idealLookAt);
            this.camera.lookAt(this.currentLookAt);
            this.isInitialized = true;
            return;
        }

        // 5. --- APPLY POSITION & LOOK-AHEAD LERP DRAG ---
        this.camera.position.lerp(idealWorldPosition, this.posLerp * deltaTime);
        this.currentLookAt.lerp(idealLookAt, this.lookLerp * deltaTime);

        // 6. --- CINEMATIC ROLLING HORIZON SLERP ---
        // Construct an ideal target rotation matrix factoring plane banking profiles
        const targetRotationMatrix = new THREE.Matrix4();
        
        // Extract aircraft world rotation up vector, then soften it slightly to create an elastic camera tilt lag
        const planeUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.mesh.quaternion);
        const smoothCameraUp = new THREE.Vector3(0, 1, 0).lerp(planeUp, 0.4); 

        targetRotationMatrix.lookAt(this.camera.position, this.currentLookAt, smoothCameraUp);
        const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(targetRotationMatrix);

        // Spherical linear interpolation smooths the camera orientation frame by frame
        this.camera.quaternion.slerp(targetQuaternion, this.rotationLerp * deltaTime);
    }
}