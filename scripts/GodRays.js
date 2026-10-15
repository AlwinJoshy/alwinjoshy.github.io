import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.117.1/build/three.module.js';
import { Pass } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/postprocessing/Pass.js';

// Screen-space god rays. Two tiny steps:
//  1) bright/sky pixels of the composer's readBuffer (tDiffuse) are radially blurred toward the
//     sun into a low-res target (default 1/4 res, 28 samples)
//  2) composite: readBuffer + rays (additive) -> writeBuffer / screen
// The pass switches itself off (zero cost) when the sun is off-screen or behind the camera.
export class GodRays {
    constructor(sunLight, opts = {}) {
        const o = Object.assign({
            resolutionScale: 0.25, samples: 28,
            intensity: 0.35, threshold: 0.62, density: 0.9, decay: 0.955,
            tint: 0xfff0d0, distance: 5000, edge: 0.25 /* NDC fade margin */
        }, opts);
        this.opts = o; this.sunLight = sunLight;
        this._pos = new THREE.Vector3(); this._ndc = new THREE.Vector3(); this._dir = new THREE.Vector3();
        this._fwd = new THREE.Vector3();
        this.enabled = true; this.fade = 0;

        const self = this;
        class GodRaysPass extends Pass {
            constructor() {
                super();
                this.rt = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
                this.blurMat = new THREE.ShaderMaterial({
                    defines: { SAMPLES: o.samples },
                    uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) },
                        uThreshold: { value: o.threshold }, uDensity: { value: o.density }, uDecay: { value: o.decay }, uAspect: { value: 1 } },
                    vertexShader: QUAD_VS, fragmentShader: BLUR_FS, depthTest: false, depthWrite: false
                });
                this.compMat = new THREE.ShaderMaterial({
                    uniforms: { tDiffuse: { value: null }, tRays: { value: this.rt.texture },
                        uIntensity: { value: 0 }, uTint: { value: new THREE.Color(o.tint) } },
                    vertexShader: QUAD_VS, fragmentShader: COMP_FS, depthTest: false, depthWrite: false
                });
                this.quad = new Pass.FullScreenQuad(this.blurMat);
            }
            setSize(w, h) {
                this.rt.setSize(Math.max(1, Math.floor(w * o.resolutionScale)), Math.max(1, Math.floor(h * o.resolutionScale)));
                this.blurMat.uniforms.uAspect.value = w / h;
            }
            render(renderer, writeBuffer, readBuffer) {
                this.blurMat.uniforms.tDiffuse.value = readBuffer.texture;
                this.quad.material = this.blurMat;
                renderer.setRenderTarget(this.rt);
                this.quad.render(renderer);
                this.compMat.uniforms.tDiffuse.value = readBuffer.texture;
                this.compMat.uniforms.uIntensity.value = o.intensity * self.fade;
                this.quad.material = this.compMat;
                renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
                if (this.clear) renderer.clear();
                this.quad.render(renderer);
            }
            dispose() { this.rt.dispose(); this.blurMat.dispose(); this.compMat.dispose(); }
        }
        this.pass = new GodRaysPass();
    }
    update(camera) {
        const o = this.opts;
        this._dir.copy(this.sunLight.position).normalize();
        camera.getWorldDirection(this._fwd);
        const facing = this._fwd.dot(this._dir);
        this._pos.copy(camera.position).addScaledVector(this._dir, o.distance);
        const n = this._ndc.copy(this._pos).project(camera);
        let f = 0;
        if (facing > 0) {
            const m = Math.max(Math.abs(n.x), Math.abs(n.y));
            f = 1 - THREE.MathUtils.smoothstep(m, 1 - o.edge, 1 + o.edge);
            f *= THREE.MathUtils.smoothstep(facing, 0.0, 0.3);
        }
        this.fade = f;
        this.pass.blurMat.uniforms.uSun.value.set(n.x * 0.5 + 0.5, n.y * 0.5 + 0.5);
        this.pass.enabled = this.enabled && f > 0.002;
    }
    setEnabled(v) { this.enabled = !!v; if (!v) this.pass.enabled = false; }
    dispose() { this.pass.dispose(); }
}

const QUAD_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BLUR_FS = `
uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uThreshold, uDensity, uDecay, uAspect;
varying vec2 vUv;
float bright(vec2 uv){ vec3 c = texture2D(tDiffuse, uv).rgb; float l = dot(c, vec3(0.299,0.587,0.114));
  vec2 d = (uv - uSun) * vec2(uAspect, 1.0);
  return max(l - uThreshold, 0.0) / (1.0 - uThreshold) * (1.0 / (1.0 + dot(d, d) * 6.0)); }
void main(){
  vec2 delta = (vUv - uSun) * (uDensity / float(SAMPLES));
  vec2 uv = vUv; float w = 1.0, sum = 0.0;
  // dither the start to hide banding with few samples
  uv -= delta * fract(sin(dot(vUv, vec2(12.9898,78.233))) * 43758.5453);
  for (int i = 0; i < SAMPLES; i++) { sum += bright(uv) * w; w *= uDecay; uv -= delta; }
  gl_FragColor = vec4(vec3(sum / float(SAMPLES)), 1.0);
}`;
const COMP_FS = `
uniform sampler2D tDiffuse, tRays; uniform float uIntensity; uniform vec3 uTint; varying vec2 vUv;
void main(){ vec4 c = texture2D(tDiffuse, vUv); c.rgb += texture2D(tRays, vUv).rgb * uTint * uIntensity; gl_FragColor = c; }`;
