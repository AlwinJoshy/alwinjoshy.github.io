import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.117.1/build/three.module.js';

// Low cloud puffs the aircraft flies through.
// One instanced draw call. Puffs are wrapped around the camera *in the vertex shader*
// (mod over a box of size 2*radius), so the CPU does nothing per frame except set uniforms.
export class LowClouds {
    constructor(scene, opts = {}) {
        const o = Object.assign({
            count: 220,          // number of puffs
            minY: 90, maxY: 220, // altitude band
            radius: 900,         // half-size of the wrap box around the camera (xz)
            minSize: 70, maxSize: 200,
            opacity: 0.5,       // halved (was 0.5)
            fresnelPower: 3,   // extra pow() on the smoothstepped fresnel; higher = thinner, denser core
            edgeSoftness: 1.1,   // width of the smoothstep fade on dot(N,V) (~1 = fade spans the whole puff)
            noiseScale: 1.0,     // noise cycles across a puff (radius units); higher = finer billows
            noiseStrength: 1.8,  // 0..1 how much noise eats into alpha / breaks up shading and silhouette
            rimShade: 0.35,      // 0..1 darken colour toward shadeColor at the rim (cheap volume cue)
            detail: 1,           // IcosahedronBufferGeometry detail (1 = 80 tris)
            squash: [0.55, 0.8], // vertical scale range (flattened puffs)
            nearFade: [6, 60],   // fully transparent at <6 units, full at >60 (soft fly-through)
            color: 0xe4e4e0,     // lit cloud colour
            shadeColor: 0x9aa3a8,// underside / shaded colour
            sunColor: 0xffd9a8,  // warm rim toward the sun
            sunDir: new THREE.Vector3(100, 30, 100),
            fogColor: 0x959999, fogDensity: 0.0008,
            seed: 1
        }, opts);
        this.opts = o;

        const ico = new THREE.IcosahedronBufferGeometry(1, o.detail); // non-indexed, unit radius
        const geo = new THREE.InstancedBufferGeometry();
        geo.setAttribute('position', ico.attributes.position);
        geo.setAttribute('normal', ico.attributes.normal);
        const shape = new Float32Array(o.count);
        const data = new Float32Array(o.count * 4);
        const rnd = mulberry(o.seed);
        for (let i = 0; i < o.count; i++) {
            data[i * 4] = (rnd() * 2 - 1) * o.radius;
            data[i * 4 + 1] = o.minY + rnd() * (o.maxY - o.minY);
            data[i * 4 + 2] = (rnd() * 2 - 1) * o.radius;
            data[i * 4 + 3] = (o.minSize + rnd() * (o.maxSize - o.minSize)) * 0.5; // radius
            shape[i] = o.squash[0] + rnd() * (o.squash[1] - o.squash[0]);
        }
        geo.setAttribute('aSquash', new THREE.InstancedBufferAttribute(shape, 1));
        geo.setAttribute('aPuff', new THREE.InstancedBufferAttribute(data, 4));
        geo.instanceCount = o.count;
        ico.dispose();

        this.uniforms = {
            uCam: { value: new THREE.Vector3() },
            uRadius: { value: o.radius },
            uOpacity: { value: o.opacity },
            uFresnel: { value: o.fresnelPower },
            uEdgeSoft: { value: o.edgeSoftness },
            uNoiseScale: { value: o.noiseScale },
            uNoiseStr: { value: o.noiseStrength },
            uRimShade: { value: o.rimShade },
            uNear: { value: new THREE.Vector2(o.nearFade[0], o.nearFade[1]) },
            uColor: { value: new THREE.Color(o.color) },
            uShade: { value: new THREE.Color(o.shadeColor) },
            uSunCol: { value: new THREE.Color(o.sunColor) },
            uSunDir: { value: o.sunDir.clone().normalize() },
            uFogColor: { value: new THREE.Color(o.fogColor) },
            uFogDensity: { value: o.fogDensity }
        };
        this.material = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: VS, fragmentShader: FS,
            transparent: true, depthWrite: false, depthTest: true, fog: false, side: THREE.FrontSide
        });
        this.mesh = new THREE.Mesh(geo, this.material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 2;
        scene.add(this.mesh);
        this.scene = scene;
    }
    update(camera /*, dt */) {
        this.uniforms.uCam.value.setFromMatrixPosition(camera.matrixWorld);
    }
    set opacity(v) { this.uniforms.uOpacity.value = v; }
    set edgeSoftness(v) { this.uniforms.uEdgeSoft.value = v; }
    set noiseScale(v) { this.uniforms.uNoiseScale.value = v; }
    set noiseStrength(v) { this.uniforms.uNoiseStr.value = v; }
    set fresnelPower(v) { this.uniforms.uFresnel.value = v; }
    setVisible(v) { this.mesh.visible = !!v; }
    dispose() {
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.material.dispose();
    }
}

function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Low-poly icosahedron puffs. Fresnel alpha: dense where the surface faces the camera,
// fading to transparent at grazing angles, so the faceted silhouette disappears.
// (Tried darkening the rim toward the shade colour as a "subtractive" cue: a mild
//  rimShade blend reads as volume; true subtractive blending looked like dirty holes against sky.)
const VS = /* glsl */`
attribute vec4 aPuff; attribute float aSquash;
uniform vec3 uCam; uniform float uRadius; uniform vec2 uNear; uniform float uNoiseScale;
varying float vFade; varying vec3 vWorld; varying vec3 vN; varying float vUp; varying vec3 vLocal;
void main() {
    vec3 c = aPuff.xyz;
    c.xz = uCam.xz + mod(c.xz - uCam.xz + uRadius, 2.0 * uRadius) - uRadius;   // wrap around camera
    float edge = 1.0 - smoothstep(0.7, 1.0, max(abs(c.x - uCam.x), abs(c.z - uCam.z)) / uRadius);
    float d = length(c - uCam);
    vFade = edge * smoothstep(uNear.x, uNear.y, d - aPuff.w);
    vec3 sc = vec3(aPuff.w, aPuff.w * aSquash, aPuff.w);
    vWorld = c + position * sc;
    vN = normalize(normal / sc);           // ellipsoid normal
    vUp = position.y * 0.5 + 0.5;
    vLocal = position * uNoiseScale + fract(aPuff.w * 0.137 + aPuff.x * 0.011) * 31.0; // per-puff noise offset
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
    if (vFade <= 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const FS = /* glsl */`
uniform float uOpacity, uFresnel, uRimShade, uFogDensity, uEdgeSoft, uNoiseStr;
uniform vec3 uColor, uShade, uSunCol, uSunDir, uFogColor, uCam;
varying float vFade; varying vec3 vWorld; varying vec3 vN; varying float vUp; varying vec3 vLocal;
float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h3(i), h3(i+vec3(1,0,0)), f.x), mix(h3(i+vec3(0,1,0)), h3(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i+vec3(0,0,1)), h3(i+vec3(1,0,1)), f.x), mix(h3(i+vec3(0,1,1)), h3(i+vec3(1,1,1)), f.x), f.y), f.z); }
void main() {
    vec3 toCam = uCam - vWorld; float dist = length(toCam);
    vec3 V = toCam / dist, N = normalize(vN);
    float ndv = max(dot(N, V), 0.0);
    // 3-octave value noise in object space (stable per puff), contrast-stretched for billowy breakup
    float nz = n3(vLocal) * 0.55 + n3(vLocal * 2.17 + 5.1) * 0.3 + n3(vLocal * 4.63 + 9.7) * 0.15;
    nz = clamp((nz - 0.5) * 2.2 + 0.5, 0.0, 1.0);
    // wispy edge: noise shifts the fresnel threshold so silhouettes are irregular, then soft smoothstep
    float edge0 = -0.1 + uNoiseStr * (nz - 0.5) * 0.6;   // low inner threshold: fade reaches deep into the puff
    float fres = pow(smoothstep(edge0, edge0 + uEdgeSoft, ndv), uFresnel);
    float body = mix(1.0, smoothstep(0.15, 0.85, nz + ndv * 0.4), uNoiseStr);
    float a = uOpacity * fres * body * vFade;
    if (a < 0.003) discard;
    float lit = clamp(dot(N, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uShade, uColor, clamp(vUp * 0.6 + lit * 0.5, 0.0, 1.0));
    col = mix(col, uShade, uRimShade * (1.0 - ndv));
    col *= 1.0 + (nz - 0.5) * 0.5 * uNoiseStr;                                          // noisy light/shade breakup
    col += uSunCol * pow(max(dot(-V, uSunDir), 0.0), 6.0) * (1.0 - ndv) * 0.6;   // forward-scatter rim
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    gl_FragColor = vec4(mix(col, uFogColor, fog), a);
}`;
