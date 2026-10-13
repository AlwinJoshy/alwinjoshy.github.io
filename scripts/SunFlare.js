import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.117.1/build/three.module.js';
import { Lensflare, LensflareElement } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/objects/Lensflare.js';

// Sun lens flare that follows a DirectionalLight's direction.
// Usage:
//   const sunFlare = new SunFlare(scene, sunLight, { distance: 5000 });
//   // each frame, before rendering:
//   sunFlare.update(camera);
const CDN = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r117/examples/textures/lensflare/';
const _dir = new THREE.Vector3();

export class SunFlare {
    constructor(scene, sunLight, options = {}) {
        this.sunLight = sunLight;
        this.distance = options.distance ?? 5000;       // keep below camera.far
        const size = options.size ?? 700;
        const color = new THREE.Color(options.color ?? 0xffe8c0);
        const path = options.texturePath ?? CDN;        // e.g. 'assets/texture/lensflare/'

        const loader = new THREE.TextureLoader();
        const main = loader.load(path + 'lensflare0.png');
        const ring = loader.load(path + 'lensflare3.png');

        this.light = new THREE.PointLight(0xffffff, 0, 0); // flare only, adds no lighting
        const flare = new Lensflare();
        flare.addElement(new LensflareElement(main, size, 0, color));
        flare.addElement(new LensflareElement(ring, size * 0.09, 0.6));
        flare.addElement(new LensflareElement(ring, size * 0.10, 0.7));
        flare.addElement(new LensflareElement(ring, size * 0.17, 0.9));
        flare.addElement(new LensflareElement(ring, size * 0.10, 1.0));
        this.flare = flare;
        this.light.add(flare);
        scene.add(this.light);
    }

    update(camera) {
        // Direction from the light's target toward the light = direction to the sun
        _dir.copy(this.sunLight.position).sub(this.sunLight.target.position);
        if (_dir.lengthSq() < 1e-8) _dir.set(0, 1, 0);
        _dir.normalize();
        this.light.position.copy(camera.position).addScaledVector(_dir, this.distance);
    }

    setVisible(v) { this.light.visible = v; }

    dispose() {
        this.light.parent?.remove(this.light);
        this.flare.dispose?.();
    }
}
