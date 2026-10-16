import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.117.1/build/three.module.js';
import { ShaderPass } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/postprocessing/ShaderPass.js';

// ---------------------------------------------------------------------------------------------
// 1. Golden-hour grade + vignette: ONE final full-screen pass.
export function createGradePass(opts = {}) {
    const o = Object.assign({
        warm: 0xffd2a0,       // highlight tint
        cool: 0x9fb4d0,       // shadow tint
        split: 0.15,          // 0..1 strength of the warm/cool split toning
        contrast: 1.04,
        saturation: 1.05,
        vignette: 0.25,       // 0..1 darkening at the corners
        vignetteSoftness: 0.55
    }, opts);
    const pass = new ShaderPass({
        uniforms: {
            tDiffuse: { value: null },
            uWarm: { value: new THREE.Color(o.warm) }, uCool: { value: new THREE.Color(o.cool) },
            uSplit: { value: o.split }, uContrast: { value: o.contrast }, uSat: { value: o.saturation },
            uVig: { value: o.vignette }, uVigSoft: { value: o.vignetteSoftness },
            uAspect: { value: 1 }
        },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
uniform sampler2D tDiffuse; uniform vec3 uWarm, uCool; uniform float uSplit, uContrast, uSat, uVig, uVigSoft, uAspect;
varying vec2 vUv;
void main() {
    vec4 t = texture2D(tDiffuse, vUv);
    vec3 c = t.rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 tint = mix(uCool, uWarm, smoothstep(0.05, 0.75, l));
    tint /= max(dot(tint, vec3(0.2126, 0.7152, 0.0722)), 1e-3);   // luminance-neutral tint
    c = mix(c, c * tint, uSplit);                       // warm highlights / cool shadows
    float l2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l2), c, uSat);
    c = (c - 0.35) * uContrast + 0.35;                        // pivot below mid-grey keeps darks from crushing
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
    float v = smoothstep(0.85, 0.85 - uVigSoft, length(p) * (1.0 / max(uAspect, 1.0)) * 1.25);
    c *= mix(1.0 - uVig, 1.0, v);
    gl_FragColor = linearToOutputTexel(vec4(max(c, 0.0), t.a));
    // interleaved-gradient-noise dither (+-0.5/255) against 8-bit banding in smooth gradients / vignette
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    gl_FragColor.rgb += (ign - 0.5) / 255.0;
}`
    });
    pass.setAspect = (a) => { pass.uniforms.uAspect.value = a; };
    return pass;
}

// ---------------------------------------------------------------------------------------------
// 2. Horizon colour from an equirect HDR (RGBELoader output) for sky-matched fog. Returns linear Color or null.
export function sampleHorizon(texture, target = new THREE.Color()) {
    const img = texture && texture.image; if (!img || !img.data) return null;
    const { data, width: W, height: H } = img, ch = data.length / (W * H);
    if (ch < 3) return null;
    const isRGBE = data instanceof Uint8Array && ch === 4, isHalf = data instanceof Uint16Array;
    if (!isRGBE && !isHalf && !(data instanceof Float32Array)) return null;
    const hf = (v) => { const e = (v >> 10) & 31, m = v & 1023; return (e === 0 ? m / 1024 * Math.pow(2, -14) : Math.pow(2, e - 15) * (1 + m / 1024)); };
    let r = 0, g = 0, b = 0, n = 0;
    for (let row = Math.floor(H * 0.47); row < Math.floor(H * 0.5); row++) {
        for (let x = 0; x < W; x += 2) {
            const k = (row * W + x) * ch;
            if (isRGBE) { const e = Math.pow(2, data[k + 3] - 136); r += data[k] * e; g += data[k + 1] * e; b += data[k + 2] * e; }
            else if (isHalf) { r += hf(data[k]); g += hf(data[k + 1]); b += hf(data[k + 2]); }
            else { r += data[k]; g += data[k + 1]; b += data[k + 2]; }
            n++;
        }
    }
    return n ? target.setRGB(r / n, g / n, b / n) : null;
}

// ---------------------------------------------------------------------------------------------
// 3. Scrolling cloud shadows on a (Basic/Lambert/Standard) material via onBeforeCompile.
//    One tileable 64x64 noise DataTexture; windOffset uniform is shared with LowClouds so they drift together.
export function makeCloudShadowTexture(size = 64, seed = 7) {
    const d = new Uint8Array(size * size * 4);
    let s = seed; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const grid = (cells) => { const a = new Float32Array(cells * cells); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; };
    const g1 = grid(8), g2 = grid(16);
    const sample = (g, cells, u, v) => { // periodic bilinear value noise, smoothstep
        const x = u * cells, y = v * cells, xi = Math.floor(x), yi = Math.floor(y);
        let fx = x - xi, fy = y - yi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
        const i0 = xi % cells, j0 = yi % cells, i1 = (i0 + 1) % cells, j1 = (j0 + 1) % cells;
        const a = g[j0 * cells + i0], b = g[j0 * cells + i1], c = g[j1 * cells + i0], e = g[j1 * cells + i1];
        return (a + (b - a) * fx) + ((c + (e - c) * fx) - (a + (b - a) * fx)) * fy;
    };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size, n = sample(g1, 8, u, v) * 0.65 + sample(g2, 16, u, v) * 0.35;
        const k = (y * size + x) * 4; d[k] = d[k + 1] = d[k + 2] = d[k + 3] = n * 255;
    }
    const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false; t.needsUpdate = true;
    return t;
}

export function addCloudShadows(material, opts = {}) {
    const o = Object.assign({ texture: null, windOffset: new THREE.Vector2(), scale: 1 / 900, strength: 0.32, coverage: 0.52, softness: 0.18 }, opts);
    const u = {
        uCSTex: { value: o.texture || makeCloudShadowTexture() },
        uCSWind: { value: o.windOffset },                // shared Vector2 (by reference)
        uCSParams: { value: new THREE.Vector4(o.scale, o.strength, o.coverage, o.softness) }
    };
    material.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, u);
        sh.vertexShader = 'varying vec2 vCSWorld;\n' + sh.vertexShader.replace('#include <project_vertex>',
            '#include <project_vertex>\n    vCSWorld = (modelMatrix * vec4(transformed, 1.0)).xz;');
        sh.fragmentShader = 'varying vec2 vCSWorld; uniform sampler2D uCSTex; uniform vec2 uCSWind; uniform vec4 uCSParams;\n' +
            sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
    float csN = texture2D(uCSTex, (vCSWorld - uCSWind) * uCSParams.x).r;
    diffuseColor.rgb *= 1.0 - uCSParams.y * smoothstep(uCSParams.z - uCSParams.w, uCSParams.z + uCSParams.w, csN);`);
    };
    material.needsUpdate = true;
    material.userData.cloudShadows = u;
    return u;
}

// three.js r117 ACESFilmicToneMapping in JS: scene fog is applied AFTER tone mapping in r117 shaders,
// so a sky colour sampled from the HDR must be tone-mapped to match the rendered sky.
export function toneMapACES(c, exposure) {
    const e = exposure / 0.6;
    let r = c.r * e, g = c.g * e, b = c.b * e;
    const ir = 0.59719 * r + 0.35458 * g + 0.04823 * b, ig = 0.07600 * r + 0.90834 * g + 0.01566 * b, ib = 0.02840 * r + 0.13383 * g + 0.83777 * b;
    const fit = (v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
    const fr = fit(ir), fg = fit(ig), fb = fit(ib);
    const cl = (v) => Math.min(1, Math.max(0, v));
    return c.setRGB(cl(1.60475 * fr - 0.53108 * fg - 0.07367 * fb), cl(-0.10208 * fr + 1.10813 * fg - 0.00605 * fb), cl(-0.00327 * fr - 0.07276 * fg + 1.07602 * fb));
}

// ---------------------------------------------------------------------------------------------
// 4. Sky-sampled fog: the fog colour is the background sky in the fragment's view direction, run through the
//    same tone mapping + output encoding as the background (r117 applies fog after both), so hazed terrain
//    matches the sky exactly at every azimuth. One cube texture lookup per fragment (only fogged materials).
//    skyUniform = { value: cubeRenderTarget.texture } (shared; may be null until the HDR loads -> scene fog colour).
export function addSkyFog(material, skyUniform, skyReady) {
    const prev = material.onBeforeCompile;
    material.onBeforeCompile = (sh, r) => {
        if (prev) prev(sh, r);
        sh.uniforms.uSkyCube = skyUniform; sh.uniforms.uSkyReady = skyReady;
        sh.vertexShader = 'varying vec3 vSkyDir;\n' + sh.vertexShader.replace('#include <fog_vertex>',
            '#include <fog_vertex>\n    vSkyDir = (modelMatrix * vec4(transformed, 1.0)).xyz - cameraPosition;');
        sh.fragmentShader = 'varying vec3 vSkyDir; uniform sampler2D uSkyCube; uniform float uSkyReady;\nvec2 skyUv(vec3 d) { return vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5); }\n' +
            sh.fragmentShader.replace('#include <fog_fragment>', `#ifdef USE_FOG
    vec3 skyD = normalize(vSkyDir); skyD.y = max(skyD.y, 0.015);        // below-horizon haze uses the horizon colour
    vec3 skyC = texture2D(uSkyCube, skyUv(skyD)).rgb;
    #if defined( TONE_MAPPING )
    skyC = toneMapping(skyC);
    #endif
    skyC = linearToOutputTexel(vec4(skyC, 1.0)).rgb;
    skyC = mix(fogColor, skyC, uSkyReady);
    float fogFactor = smoothstep(fogNear, fogFar, fogDepth);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, skyC, fogFactor);
#endif`);
    };
    material.needsUpdate = true;
}

// ---------------------------------------------------------------------------------------------
// 5. Sky background as one fullscreen triangle: per-pixel view ray (from the camera's inverse projection,
//    including setViewOffset) -> cube map lookup, same tone mapping/encoding as everything else.
//    Replaces scene.background's box, which rendered as flat-coloured facets here (per-triangle direction
//    interpolation across the camera-centred box), so its colours never matched the fog.
//    Uniforms reference the camera's own matrices: zero per-frame work.
export function createSkyMesh(camera, skyUniform) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const m = new THREE.ShaderMaterial({
        uniforms: { uSkyCube: skyUniform, uInvProj: { value: camera.projectionMatrixInverse }, uCamWorld: { value: camera.matrixWorld } },
        vertexShader: `uniform mat4 uInvProj, uCamWorld; varying vec3 vDir;
void main() {
    vec4 p = uInvProj * vec4(position.xy, -1.0, 1.0);          // point on the near plane (view space)
    vDir = mat3(uCamWorld) * (p.xyz / p.w);
    gl_Position = vec4(position.xy, 1.0, 1.0);
}`,
        fragmentShader: `uniform sampler2D uSkyCube; varying vec3 vDir;
vec2 skyUv(vec3 d) { return vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5); }
void main() {
    gl_FragColor = vec4(texture2D(uSkyCube, skyUv(normalize(vDir))).rgb, 1.0);
    #include <tonemapping_fragment>
    #include <encodings_fragment>
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    gl_FragColor.rgb += (ign - 0.5) / 255.0;   // dither (helps when composer targets are 8-bit)
}`,
        depthTest: false, depthWrite: false, fog: false
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false; mesh.renderOrder = -1000; mesh.raycast = () => {};
    return mesh;
}
