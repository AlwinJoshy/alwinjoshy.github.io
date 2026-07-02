import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.117.1/build/three.module.js';

export class WingtipVapor {
    constructor(scene, aircraftMesh, config = {}) {
        this.mesh = aircraftMesh;
        this.maxParticles = config.maxParticles || 200; 
        
        this.leftWingOffset = config.leftWing || new THREE.Vector3(-4.5, 0, -1.0);
        this.rightWingOffset = config.rightWing || new THREE.Vector3(4.5, 0, -1.0);

        // 1. INCREASED BASE SIZE so they are visible from the chase camera
        const geometry = new THREE.PlaneBufferGeometry(3, 3);
        
        const material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            // 2. CRITICAL FIX: Ensure the planes render from the back
            side: THREE.DoubleSide 
        });

        this.instancedMesh = new THREE.InstancedMesh(geometry, material, this.maxParticles * 2);
        this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        
        const dummyMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
        for (let i = 0; i < this.maxParticles * 2; i++) {
            this.instancedMesh.setMatrixAt(i, dummyMatrix);
            this.instancedMesh.setColorAt(i, new THREE.Color(0x000000));
        }

        scene.add(this.instancedMesh);

        this.particles = [];
        this.currentIndex = 0;
        
        for (let i = 0; i < this.maxParticles * 2; i++) {
            this.particles.push({
                active: false,
                position: new THREE.Vector3(),
                age: 0,
                maxLife: config.lifeTime || 1.5 
            });
        }

        this.dummy = new THREE.Object3D();
        this.color = new THREE.Color();
    }

    // 3. PASSED IN THE CAMERA to align the particles
    update(deltaTime, intensity = 1.0, camera) {
        if (!this.mesh) return;

        // 4. MATRIX FIX: Force the plane to calculate its exact position this frame
        // before we pull the wing offsets, so the trails don't lag behind the model.
        this.mesh.updateMatrixWorld(true);

        if (intensity > 0.1) {
            const leftWorld = this.leftWingOffset.clone().applyMatrix4(this.mesh.matrixWorld);
            const rightWorld = this.rightWingOffset.clone().applyMatrix4(this.mesh.matrixWorld);

            this.spawnParticle(leftWorld, this.currentIndex);
            this.spawnParticle(rightWorld, this.currentIndex + 1);

            this.currentIndex = (this.currentIndex + 2) % (this.maxParticles * 2);
        }

        for (let i = 0; i < this.maxParticles * 2; i++) {
            const p = this.particles[i];
            
            if (p.active) {
                p.age += deltaTime;

                if (p.age >= p.maxLife) {
                    p.active = false;
                    this.instancedMesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0,0,0));
                } else {
                    const lifeRatio = p.age / p.maxLife;
                    
                    // Slightly softened the expansion scale
                    const scale = 1.0 + (lifeRatio * 3.0); 

                    // Ensure high turn intensity makes it bright white, fading out cleanly
                    const brightness = (1.0 - lifeRatio) * Math.min(intensity, 1.0);
                    this.color.setRGB(brightness, brightness, brightness);
                    this.instancedMesh.setColorAt(i, this.color);

                    this.dummy.position.copy(p.position);
                    this.dummy.scale.set(scale, scale, scale);
                    
                    // 5. BILLBOARD FIX: Make the planes constantly rotate to face the camera
                    if (camera) {
                        this.dummy.lookAt(camera.position);
                    }

                    this.dummy.updateMatrix();
                    this.instancedMesh.setMatrixAt(i, this.dummy.matrix);
                }
            }
        }

        this.instancedMesh.instanceMatrix.needsUpdate = true;
        this.instancedMesh.instanceColor.needsUpdate = true;
    }

    spawnParticle(worldPosition, index) {
        const p = this.particles[index];
        p.active = true;
        p.age = 0;
        p.position.copy(worldPosition);
    }
}