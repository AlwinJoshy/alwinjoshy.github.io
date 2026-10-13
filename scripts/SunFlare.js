// Cinematic lens flare for three.js r117.1: starburst, fine streaks, spectral halo,
// anamorphic streak and a chain of hexagonal ghosts. Everything is procedural (shaders
// plus one small random DataTexture), drawn in 2 draw calls in its own overlay scene
// AFTER the composer, so it is not tone-mapped, fogged or depth-tested.
//
//   sunFlare.update(camera);    // before composer.render()
//   composer.render();
//   sunFlare.render(renderer);  // right after composer.render()
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.117.1/build/three.module.js';

const VERT_SUN = `
uniform vec2 uSun; uniform vec2 uRes; uniform float uSize;
varying vec2 vP;
void main(){
  vP = position.xy * vec2(2.6, 1.0) * uSize;           // pixel offset from the sun
  gl_Position = vec4(uSun + vP * 2.0 / uRes, 0.0, 1.0);
}`;
const FRAG_SUN = `
uniform float uSize, uIntensity, uRot, uRays, uStreak, uHalo, uAnamorphic;
uniform float uCoreSize, uCore, uRayLen, uRayInt, uRayThin, uStreakLen, uHaloRadius, uHaloWidth, uAnaLen, uAnaThick;
uniform vec3 uCoreColor, uRayColor, uAnaColor;
uniform sampler2D uNoise;
varying vec2 vP;
vec3 spectrum(float x){ // 0..1 -> red..violet
  return clamp(vec3(abs(x*6.0-3.0)-1.0, 2.0-abs(x*6.0-2.0), 2.0-abs(x*6.0-4.0)), 0.0, 1.0).bgr;
}
void main(){
  float r = length(vP) / uSize;
  float a = atan(vP.y, vP.x) + uRot;
  vec3 warm = vec3(1.0, 0.9, 0.75);
  float rc = r / uCoreSize;
  vec3 c = uCoreColor * (exp(-rc*rc*1600.0)*2.0 + exp(-rc*30.0)*0.7 + exp(-rc*6.0)*0.12) * uCore;
  float rr = r / uRayLen;
  float fall = exp(-rr*3.2) * (1.0 - smoothstep(0.6, 1.0, rr));
  float rays = pow(abs(cos(a * uRays * 0.5)), uRayThin) * fall * 1.1 * uRayInt;
  float n = texture2D(uNoise, vec2(a / 6.2831853, 0.5)).r;
  float n2 = texture2D(uNoise, vec2(a / 6.2831853 * 3.0 + 0.37, 0.5)).g;
  float streaks = pow(n, 9.0) * pow(n2, 3.0) * exp(-r/uStreakLen*5.5) * 2.2 * uStreak;
  c += uRayColor * (rays + streaks);
  float hr = uHaloRadius, hw = uHaloWidth;
  float hx = (r - hr) / hw;
  c += spectrum(clamp(hx*0.5+0.5, 0.0, 1.0)) * exp(-hx*hx*1.6) * 0.22 * uHalo;
  float ay = abs(vP.y) / uSize, ax = abs(vP.x) / uSize;
  c += uAnaColor * exp(-ay*140.0/uAnaThick) * exp(-ax*0.9/uAnaLen) * 0.9 * uAnamorphic;
  gl_FragColor = vec4(c * uIntensity, 1.0);
}`;
const VERT_GHOST = `
attribute vec2 aCorner; attribute vec4 aGhost; attribute vec3 aColor; // aGhost: k, size, shape, rot
uniform float uGhostScale;
uniform vec2 uSun; uniform vec2 uRes; uniform float uSize;
varying vec2 vQ; varying vec3 vC; varying float vShape;
void main(){
  vQ = aCorner; vC = aColor; vShape = aGhost.z;
  float cs = cos(aGhost.w), sn = sin(aGhost.w);
  vec2 q = vec2(cs*aCorner.x - sn*aCorner.y, sn*aCorner.x + cs*aCorner.y);
  vec2 centre = uSun * aGhost.x;                        // line sun -> screen centre -> beyond
  gl_Position = vec4(centre + q * aGhost.y * uSize * uGhostScale * 2.0 / uRes, 0.0, 1.0);
}`;
const FRAG_GHOST = `
uniform float uIntensity; uniform vec3 uGhostColor;
varying vec2 vQ; varying vec3 vC; varying float vShape;
void main(){
  vec2 q = abs(vQ);
  float hex = max(q.x*0.866025 + q.y*0.5, q.y);         // hexagon aperture
  float d = vShape < 0.5 ? hex : length(vQ);
  float body = 1.0 - smoothstep(0.82, 0.9, d);
  float rim = exp(-pow((d-0.86)*18.0, 2.0));
  float g;
  if (vShape < 0.5) g = body*0.35 + rim*0.5;            // hex
  else if (vShape < 1.5) g = rim * 0.9;                 // thin ring
  else g = (1.0 - smoothstep(0.0, 0.9, d)) * 0.6;       // soft disk
  vec3 fringe = mix(vC, vC.gbr, smoothstep(0.7, 0.95, d)); // chromatic edge
  gl_FragColor = vec4(fringe * uGhostColor * g * uIntensity, 1.0);
}`;

export class SunFlare {
    constructor(scene, sunLight, options = {}) {
        this.scene = scene;
        this.sunLight = sunLight;
        this.distance = options.distance ?? 5000;
        this.size = options.size ?? 300;            // starburst radius in px at 1080p height
        this.intensity = options.intensity ?? 0.5;
        this.rotateSpeed = options.rotateSpeed ?? 0.35; // rotation per radian of sun screen angle
        this.occluders = options.occluders ?? null;  // array or () => array; default: terrain LODs in scene
        this.occlusionInterval = options.occlusionInterval ?? 4; // frames between raycasts
        this.visible = true;
        this.vis = 0; this._target = 0; this._frame = 0; this._last = 0; this._onScreen = false;

        // random noise texture for the fine streaks
        const N = 512, data = new Uint8Array(N * 4);
        for (let i = 0; i < N * 4; i++) data[i] = Math.random() * 255;
        this.noise = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat);
        this.noise.wrapS = THREE.RepeatWrapping;
        this.noise.magFilter = this.noise.minFilter = THREE.LinearFilter;
        this.noise.needsUpdate = true;

        this.uniforms = {
            uSun: { value: new THREE.Vector2() }, uRes: { value: new THREE.Vector2(1, 1) },
            uSize: { value: this.size }, uIntensity: { value: 0 }, uRot: { value: 0 },
            uRays: { value: options.rayCount ?? 8 }, uStreak: { value: options.streakIntensity ?? 1.0 },
            uHalo: { value: options.haloIntensity ?? 0.3 }, uAnamorphic: { value: options.anamorphicIntensity ?? 0.5 },
            uNoise: { value: this.noise },
            uCoreSize: { value: options.coreSize ?? 1.0 }, uCore: { value: options.coreIntensity ?? 1.0 },
            uRayLen: { value: options.rayLength ?? 1.0 }, uRayInt: { value: options.rayIntensity ?? 1.0 },
            uRayThin: { value: options.rayThinness ?? 600.0 }, uStreakLen: { value: options.streakLength ?? 1.0 },
            uHaloRadius: { value: options.haloRadius ?? 0.42 }, uHaloWidth: { value: options.haloWidth ?? 0.035 },
            uCoreColor: { value: new THREE.Color(options.coreColor ?? 0xffe6bf) },
            uRayColor: { value: new THREE.Color(options.rayColor ?? 0xffe6bf) },
            uAnaColor: { value: new THREE.Color(options.anamorphicColor ?? 0x4080ff) },
            uAnaLen: { value: options.anamorphicLength ?? 1.0 }, uAnaThick: { value: options.anamorphicThickness ?? 1.0 },
        };
        this.ghostUniforms = {
            uSun: this.uniforms.uSun, uRes: this.uniforms.uRes, uSize: { value: 1 },
            uIntensity: { value: 0 }, uGhostScale: { value: options.ghostSize ?? 1.0 }, uGhostInt: { value: 1.0 },
            uGhostColor: { value: new THREE.Color(options.ghostColor ?? 0xffffff) },
        };
        const matOpts = { transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending };
        this.sunMat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT_SUN, fragmentShader: FRAG_SUN, ...matOpts });
        this.ghostMat = new THREE.ShaderMaterial({ uniforms: this.ghostUniforms, vertexShader: VERT_GHOST, fragmentShader: FRAG_GHOST, ...matOpts });

        this.overlay = new THREE.Scene();
        this.overlayCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.sunGeo = new THREE.PlaneBufferGeometry(2, 2);
        this.sunMesh = new THREE.Mesh(this.sunGeo, this.sunMat);
        this.ghostIntensity = options.ghostIntensity ?? 1.0;
        this.ghostGeo = this._buildGhosts(options.ghostCount ?? 9, 1.0);
        this.ghostMesh = new THREE.Mesh(this.ghostGeo, this.ghostMat);
        this.sunMesh.frustumCulled = this.ghostMesh.frustumCulled = false;
        this.overlay.add(this.ghostMesh, this.sunMesh);

        this._buf3 = new THREE.Vector3(); this._dir = new THREE.Vector3(); this._pos = new THREE.Vector3();
        this._ndc = new THREE.Vector3(); this._buf = new THREE.Vector2();
        this._ray = new THREE.Raycaster(); this._hits = []; this._occ = [];
    }

    _buildGhosts(count, gain) {
        const tints = [[1, .55, .25], [.35, 1, .5], [.3, .5, 1], [1, .3, .7], [.9, .85, .3], [.4, .9, 1]];
        const corners = [-1, -1, 1, -1, 1, 1, -1, 1];
        const aCorner = new Float32Array(count * 8), aGhost = new Float32Array(count * 16), aColor = new Float32Array(count * 12);
        const index = [];
        // deterministic layout: k < 0 = reversed on the far side of the screen centre
        const ks = [0.62, 0.35, 0.12, -0.18, -0.38, -0.55, -0.8, -1.05, -1.35, 0.8, -0.27, -1.6];
        for (let i = 0; i < count; i++) {
            const k = ks[i % ks.length] - Math.floor(i / ks.length) * 0.07;
            const shape = i % 3 === 1 ? 1 : (i % 4 === 3 ? 2 : 0);
            const size = (shape === 1 ? 0.22 : 0.06 + 0.09 * ((i * 37) % 7) / 6) * (1 + Math.abs(k) * 0.4);
            const t = tints[i % tints.length], g = gain * (shape === 1 ? 0.4 : 0.5) / (1 + Math.abs(k));
            for (let v = 0; v < 4; v++) {
                aCorner.set([corners[v * 2], corners[v * 2 + 1]], (i * 4 + v) * 2);
                aGhost.set([k, size, shape, i * 0.4], (i * 4 + v) * 4);
                aColor.set([t[0] * g, t[1] * g, t[2] * g], (i * 4 + v) * 3);
            }
            const b = i * 4; index.push(b, b + 1, b + 2, b, b + 2, b + 3);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 12), 3)); // unused
        geo.setAttribute('aCorner', new THREE.BufferAttribute(aCorner, 2));
        geo.setAttribute('aGhost', new THREE.BufferAttribute(aGhost, 4));
        geo.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3));
        geo.setIndex(index);
        return geo;
    }

    _occludersList() {
        if (typeof this.occluders === 'function') return this.occluders();
        if (Array.isArray(this.occluders)) return this.occluders;
        const list = this._occ; list.length = 0;            // default: terrain tiles (THREE.LOD)
        const ch = this.scene.children;
        for (let i = 0; i < ch.length; i++) if (ch[i].isLOD && ch[i].visible) list.push(ch[i]);
        return list;
    }

    update(camera) {
        const now = performance.now();
        const dt = Math.min(0.1, this._last ? (now - this._last) / 1000 : 0.016);
        this._last = now;
        this._dir.copy(this.sunLight.position).normalize();
        this._pos.copy(camera.position).addScaledVector(this._dir, this.distance);
        this._ndc.copy(this._pos).project(camera);
        const n = this._ndc;
        camera.getWorldDirection(this._buf3);
        const inFront = this._buf3.dot(this._dir) > 0;
        this._onScreen = inFront && Math.abs(n.x) < 1.4 && Math.abs(n.y) < 1.4;

        if (this._onScreen && (this._frame++ % this.occlusionInterval) === 0) {
            this._ray.set(camera.position, this._dir);
            this._ray.near = 0.5; this._ray.far = this.distance;
            this._hits.length = 0;
            this._ray.intersectObjects(this._occludersList(), true, this._hits);
            this._target = this._hits.length ? 0 : 1;
        }
        if (!this._onScreen) this._target = 0;
        this.vis += (this._target - this.vis) * Math.min(1, dt * 6);

        const edge = 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(n.x), Math.abs(n.y)), 0.75, 1.35);
        const I = this.visible ? this.vis * edge * this.intensity : 0;
        this.uniforms.uSun.value.set(n.x, n.y);
        this.uniforms.uIntensity.value = I;
        this.ghostUniforms.uIntensity.value = this.ghostIntensity * I * (0.4 + 0.6 * Math.min(1, Math.hypot(n.x, n.y)));
        this.uniforms.uRot.value = Math.atan2(n.y, n.x) * this.rotateSpeed;
    }

    // Live tweaking: sunFlare.set({ haloRadius: 0.5, rayIntensity: 2 })
    set(o) {
        const u = this.uniforms, map = {
            rayCount: 'uRays', streakIntensity: 'uStreak', haloIntensity: 'uHalo', anamorphicIntensity: 'uAnamorphic',
            coreSize: 'uCoreSize', coreIntensity: 'uCore', rayLength: 'uRayLen', rayIntensity: 'uRayInt',
            rayThinness: 'uRayThin', streakLength: 'uStreakLen', haloRadius: 'uHaloRadius', haloWidth: 'uHaloWidth',
            anamorphicLength: 'uAnaLen', anamorphicThickness: 'uAnaThick' };
        for (const k in o) {
            if (map[k]) u[map[k]].value = o[k];
            else if (k === 'coreColor') u.uCoreColor.value.set(o[k]);
            else if (k === 'rayColor') u.uRayColor.value.set(o[k]);
            else if (k === 'anamorphicColor') u.uAnaColor.value.set(o[k]);
            else if (k === 'ghostColor') this.ghostUniforms.uGhostColor.value.set(o[k]);
            else if (k === 'ghostSize') this.ghostUniforms.uGhostScale.value = o[k];
            else if (k in this) this[k] = o[k];   // size, intensity, ghostIntensity, rotateSpeed, distance
        }
    }

    render(renderer) {
        if (this.uniforms.uIntensity.value < 0.002) return;
        renderer.getDrawingBufferSize(this._buf);
        this.uniforms.uRes.value.copy(this._buf);
        const px = this.size * this._buf.y / 1080;
        this.uniforms.uSize.value = px;
        this.ghostUniforms.uSize.value = px;
        const autoClear = renderer.autoClear;
        renderer.autoClear = false;
        renderer.setRenderTarget(null);
        renderer.render(this.overlay, this.overlayCam);
        renderer.autoClear = autoClear;
    }

    setVisible(v) { this.visible = !!v; }

    dispose() {
        this.sunGeo.dispose(); this.ghostGeo.dispose();
        this.sunMat.dispose(); this.ghostMat.dispose(); this.noise.dispose();
    }
}
