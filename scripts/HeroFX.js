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
        vignetteSoftness: 0.55,
        lift: 0.0,            // shadow lift (raises the black point toward the cool tint)
        sunGlow: 0.0,         // 0..1 broad warm glow toward the sun's screen position (setSun each frame)
        sunGlowColor: 0xff9850
    }, opts);
    const pass = new ShaderPass({
        uniforms: {
            tDiffuse: { value: null },
            uWarm: { value: new THREE.Color(o.warm) }, uCool: { value: new THREE.Color(o.cool) },
            uSplit: { value: o.split }, uContrast: { value: o.contrast }, uSat: { value: o.saturation },
            uVig: { value: o.vignette }, uVigSoft: { value: o.vignetteSoftness },
            uAspect: { value: 1 },
            uLift: { value: o.lift }, uSunGlow: { value: o.sunGlow }, uSunCol: { value: new THREE.Color(o.sunGlowColor) },
            uSun: { value: new THREE.Vector3(0.5, 0.5, 0) }   // xy = sun uv, z = 1 if in front of camera
        },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
uniform sampler2D tDiffuse; uniform vec3 uWarm, uCool, uSunCol, uSun; uniform float uSplit, uContrast, uSat, uVig, uVigSoft, uAspect, uLift, uSunGlow;
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
    c += uLift * uCool * (1.0 - smoothstep(0.0, 0.35, l));        // lifted, slightly cool shadows
    // sunset: broad warm glow around the sun (screen space; fades when the sun is behind the camera / far off-screen)
    vec2 sd = (vUv - uSun.xy) * vec2(uAspect, 1.0);
    float g = exp(-dot(sd, sd) * 1.6) * uSun.z * uSunGlow;
    c = mix(c, c * uSunCol * 1.6 + uSunCol * 0.04, g);    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
    float v = smoothstep(0.85, 0.85 - uVigSoft, length(p) * (1.0 / max(uAspect, 1.0)) * 1.25);
    c *= mix(1.0 - uVig, 1.0, v);
    gl_FragColor = linearToOutputTexel(vec4(max(c, 0.0), t.a));
    // interleaved-gradient-noise dither (+-0.5/255) against 8-bit banding in smooth gradients / vignette
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    gl_FragColor.rgb += (ign - 0.5) / 255.0;
}`
    });
    pass.setAspect = (a) => { pass.uniforms.uAspect.value = a; };
    pass.setSun = (x, y, vis) => { pass.uniforms.uSun.value.set(x, y, vis); };
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

// InstancedMesh-aware world position for the patches below (instanceMatrix is applied before modelMatrix).
const HFX_INST_DEF = '#ifndef HFX_INST\n#ifdef USE_INSTANCING\n#define HFX_INST(p) (instanceMatrix * (p))\n#else\n#define HFX_INST(p) (p)\n#endif\n#endif\n';

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
    const prev = material.onBeforeCompile;   // chain (e.g. PropSpawner's rounded-foliage normal patch)
    material.onBeforeCompile = (sh, r) => {
        if (prev) prev(sh, r);
        Object.assign(sh.uniforms, u);
        sh.vertexShader = HFX_INST_DEF + 'varying vec2 vCSWorld;\n' + sh.vertexShader.replace('#include <project_vertex>',
            '#include <project_vertex>\n    vCSWorld = (modelMatrix * HFX_INST(vec4(transformed, 1.0))).xz;');
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
        sh.vertexShader = HFX_INST_DEF + 'varying vec3 vSkyDir;\n' + sh.vertexShader.replace('#include <fog_vertex>',
            '#include <fog_vertex>\n    vSkyDir = (modelMatrix * HFX_INST(vec4(transformed, 1.0))).xyz - cameraPosition;');
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

// ---------------------------------------------------------------------------------------------
// Near-camera terrain detail: one channel-packed tiling texture (R = snow, G = rock, B = grass luminance
// detail, 0.5 = neutral). Weights: bright base texel -> snow, steep world normal -> rock, else grass.
// Applied as a luminance modulation of the base map so the base colours dominate; fades out by distance.
// Cost: 1 texture lookup + a few ALU ops per terrain pixel. Chains any existing onBeforeCompile.
export function addTerrainDetail(material, texture, opts = {}) {
    const o = Object.assign({ scale: 1 / 18, near: 700, far: 1400, strength: 1.0, snow: [0.62, 0.82], rock: [0.86, 0.62] }, opts);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    const u = {
        uDtTex: { value: texture }, uDtScale: { value: o.scale }, uDtStr: { value: o.strength },
        uDtFade: { value: new THREE.Vector2(o.near, o.far) },
        uDtSnow: { value: new THREE.Vector2(o.snow[0], o.snow[1]) }, uDtRock: { value: new THREE.Vector2(o.rock[0], o.rock[1]) }
    };
    const prev = material.onBeforeCompile;
    material.onBeforeCompile = (sh, r) => {
        if (prev) prev(sh, r);
        Object.assign(sh.uniforms, u);
        sh.vertexShader = 'varying vec3 vDtW; varying float vDtNy;\n' + sh.vertexShader.replace('#include <project_vertex>',
            '#include <project_vertex>\n    vDtW = (modelMatrix * vec4(transformed, 1.0)).xyz; vDtNy = normalize(mat3(modelMatrix) * normal).y;');
        sh.fragmentShader = 'varying vec3 vDtW; varying float vDtNy; uniform sampler2D uDtTex; uniform float uDtScale, uDtStr; uniform vec2 uDtFade, uDtSnow, uDtRock;\n' +
            sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
    {
        float dFade = 1.0 - smoothstep(uDtFade.x, uDtFade.y, distance(vDtW, cameraPosition));
        vec3 dt = texture2D(uDtTex, vDtW.xz * uDtScale).rgb * 2.0 - 1.0;
        float wS = smoothstep(uDtSnow.x, uDtSnow.y, dot(texelColor.rgb, vec3(0.299, 0.587, 0.114)));
        float wR = (1.0 - wS) * smoothstep(uDtRock.x, uDtRock.y, vDtNy);
        float d = dt.r * wS + dt.g * wR + dt.b * (1.0 - wS - wR);
        diffuseColor.rgb *= 1.0 + d * uDtStr * dFade;
    }`);
    };
    return u;
}

// ---------------------------------------------------------------------------------------------
// Hemisphere fill: cool sky from above, warm ground bounce from below, added to the indirect light of
// Phong/Lambert/Standard materials (terrain, props). Uniforms are shared, so one change updates everything.
//   fill = createFill(cfg) -> { uniforms, apply(cfg), setSkyFromTexture(hdrTexture) }
//   fillGLSL(mulUniform): GLSL injected after <lights_fragment_end> (uses the final shading normal).
export function createFill(cfg = {}) {
    const u = {
        uFillSky: { value: new THREE.Color(0x9db4d6) }, uFillGround: { value: new THREE.Color(0x6e4a30) },
        uFillI: { value: 0.3 }, uShStr: { value: 0.8 }
    };
    let skyAuto = true, skyTint = 1.0, skyBand = 0.25;
    const sky = new THREE.Color(), lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const api = {
        uniforms: u, skyColor: new THREE.Color(0x9db4d6),
        apply(c) {
            if (c.fillSky !== undefined) {
                skyAuto = c.fillSky === 'auto';
                if (!skyAuto) u.uFillSky.value.set(c.fillSky);
            }
            if (c.fillSkyFallback !== undefined && skyAuto) u.uFillSky.value.set(c.fillSkyFallback);
            if (c.fillGround !== undefined) u.uFillGround.value.set(c.fillGround);
            if (c.fillIntensity !== undefined) u.uFillI.value = c.fillIntensity;
            if (c.shadowStrength !== undefined) u.uShStr.value = Math.min(1, Math.max(0, c.shadowStrength));
            if (c.autoSkySaturation !== undefined) skyTint = c.autoSkySaturation;
            if (c.autoSkyBand !== undefined) skyBand = c.autoSkyBand;
            return api;
        },
        // average of the upper sky (rows from the zenith down to autoSkyBand of the image, cos-weighted), normalised to
        // luminance 1 -> the fill's hue matches the sky overhead; brightness stays under fillIntensity's control.
        setSkyFromTexture(texture) {
            if (!skyAuto || !sampleSkyAverage(texture, sky, skyBand)) return false;
            const l = Math.max(lum(sky), 1e-4); sky.multiplyScalar(1 / l);
            const g = new THREE.Color(1, 1, 1); sky.lerp(g, 1 - skyTint);     // keep some of the sky's hue
            u.uFillSky.value.copy(sky); api.skyColor.copy(sky);
            return true;
        }
    };
    return api.apply(cfg);
}
export function sampleSkyAverage(texture, target = new THREE.Color(), upTo = 0.5) {   // upTo: fraction of rows from the top (0.5 = whole upper hemisphere)
    const img = texture && texture.image; if (!img || !img.data) return null;
    const { data, width: W, height: H } = img, ch = data.length / (W * H);
    const isHalf = data instanceof Uint16Array, isRGBE = data instanceof Uint8Array && ch === 4;
    const hf = (v) => { const e = (v >> 10) & 31, m = v & 1023; return (e === 0 ? m / 1024 * Math.pow(2, -14) : Math.pow(2, e - 15) * (1 + m / 1024)); };
    let r = 0, g = 0, b = 0, wsum = 0;
    for (let row = 0; row < Math.floor(H * upTo); row += 2) {
        const w = Math.sin(Math.PI * (row + 0.5) / H);      // equirect row weight (cos of latitude)
        for (let x = 0; x < W; x += 4) {
            const k = (row * W + x) * ch;
            let cr, cg, cb;
            if (isRGBE) { const e = Math.pow(2, data[k + 3] - 136); cr = data[k] * e; cg = data[k + 1] * e; cb = data[k + 2] * e; }
            else if (isHalf) { cr = hf(data[k]); cg = hf(data[k + 1]); cb = hf(data[k + 2]); }
            else { cr = data[k]; cg = data[k + 1]; cb = data[k + 2]; }
            r += cr * w; g += cg * w; b += cb * w; wsum += w;
        }
    }
    return wsum ? target.setRGB(r / wsum, g / wsum, b / wsum) : null;
}
export const FILL_DECL = 'uniform vec3 uFillSky, uFillGround; uniform float uFillI, uShStr;\n';
export function fillGLSL(mul) {
    return `
    {   // hemisphere fill (world-space normal: sky above, warm bounce below)
        float fH = inverseTransformDirection(normal, viewMatrix).y * 0.5 + 0.5;
        reflectedLight.indirectDiffuse += material.diffuseColor * mix(uFillGround, uFillSky, fH) * (uFillI * ${mul});
    }`;
}

// ---------------------------------------------------------------------------------------------
// 6. Procedural terrain texturing for a MeshPhongMaterial (per-pixel sun + ambient, receives shadows).
//    Layers: grass on flat ground, rock on steep slopes (world normal y), snow by height and on flatter high
//    ground (+ the snow painted in the land map). Blends are smoothstep bands broken up by 2-octave value noise.
//    Albedo + normal per layer, blended with the same weights. Grass/snow use world-XZ UVs; rock is triplanar.
//    Normals: whiteout blend in world space (no tangents needed), then to view space for three's lighting.
//    The painted land map (material.map) stays as a low-frequency tint / AO / painted-snow mask.
//    lite: no normal maps, rock on world-XZ only -> 3 detail lookups instead of 10 (low tier).
//    Every setting is a uniform: change cfg values at runtime with api.apply(cfg) (or the uniforms directly),
//    swap textures with api.setTerrainTexture(layer, 'albedo' | 'normal', url).
//    cfg: see TERRAIN in threeJS_WWII.js. Sun shadows fade out toward the edge of the shadow frustum.
export function addTerrainSplat(material, cfg) {
    const lite = !!cfg.lite;
    // hemisphere fill + shadow strength (shared uniforms from createFill; neutral defaults if none given)
    const fillU = cfg.fill ? cfg.fill.uniforms : { uFillSky: { value: new THREE.Color() }, uFillGround: { value: new THREE.Color() }, uFillI: { value: 0 }, uShStr: { value: 1 } };
    const L = ['grass', 'rock', 'snow'];
    const loader = new THREE.TextureLoader();
    const prep = (t) => { t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; };
    const load = (url, cb) => prep(loader.load(url, cb, undefined, () => console.warn('terrain texture failed: ' + url)));
    const v3 = () => new THREE.Vector3();
    const u = {
        uTGA: { value: null }, uTRA: { value: null }, uTSA: { value: null },
        uTGN: { value: null }, uTRN: { value: null }, uTSN: { value: null },
        uTMN: { value: null },           // base (macro) normal baked from the high-detail terrain, once per tile
        uTMNP: { value: new THREE.Vector4(1, 1, 1, 1) },   // tiling, strength, red sign, green sign
        uTMNMirror: { value: 1 },        // 1 = mirror U (the land mesh is mirrored in X)
        uTScale: { value: v3() },        // 1 / tiling (metres per repeat), per layer (grass, rock, snow)
        uTNStr: { value: v3() },         // normal strength per layer
        uTTintG: { value: v3() }, uTTintR: { value: v3() }, uTTintS: { value: v3() },   // tint x brightness (linear)
        uTRock: { value: new THREE.Vector2() },     // normal.y band: full rock below x, none above y
        uTSnow: { value: v3() },                    // snow height start, end, slope limit (normal.y)
        uTPaint: { value: new THREE.Vector2() },    // land-map luminance band read as painted snow
        uTNoise: { value: new THREE.Vector2() },    // noise scale (1/m), amount
        uTSharp: { value: 1 },                      // blend sharpness (1 = as authored, >1 = harder edges)
        uTMacro: { value: 0 }, uTMacroMin: { value: 0 }, uTMean: { value: v3() }, uTSat: { value: 1 },
        uTAmb: { value: v3() }, uTSun: { value: 1 },
        uShCenter: { value: new THREE.Vector2() }, uShFade: { value: new THREE.Vector2(300, 420) }
    };
    const key = { grass: ['uTGA', 'uTGN'], rock: ['uTRA', 'uTRN'], snow: ['uTSA', 'uTSN'], base: ['uTMN', 'uTMN'] };
    const _c = new THREE.Color();
    const api = {
        uniforms: u, lite,
        apply(c) {        // (re)apply any subset of the config to the uniforms
            const ly = c.layers || {};
            L.forEach((name, k) => {
                const l = ly[name]; if (!l) return;
                const ax = ['x', 'y', 'z'][k];
                if (l.tiling !== undefined) u.uTScale.value[ax] = 1 / l.tiling;
                if (l.normalStrength !== undefined) u.uTNStr.value[ax] = l.normalStrength;
                if (l.tint !== undefined || l.brightness !== undefined) {
                    l.tint = l.tint !== undefined ? l.tint : 0xffffff; l.brightness = l.brightness !== undefined ? l.brightness : 1;
                    _c.set(l.tint); const t = u[['uTTintG', 'uTTintR', 'uTTintS'][k]].value;
                    t.set(_c.r, _c.g, _c.b).multiplyScalar(l.brightness);
                }
            });
            const bn = c.baseNormal;
            if (bn) {
                if (bn.tiling !== undefined) u.uTMNP.value.x = bn.tiling;
                if (bn.strength !== undefined) u.uTMNP.value.y = bn.strength;
                if (bn.flipRed !== undefined) u.uTMNP.value.z = bn.flipRed ? -1 : 1;
                if (bn.flipGreen !== undefined) u.uTMNP.value.w = bn.flipGreen ? -1 : 1;
                if (bn.mirrorU !== undefined) u.uTMNMirror.value = bn.mirrorU ? 1 : 0;
            }
            const b = c.blend || {};
            if (b.rockSlope) u.uTRock.value.set(b.rockSlope[0], b.rockSlope[1]);
            if (b.snowHeight) { u.uTSnow.value.x = b.snowHeight[0]; u.uTSnow.value.y = b.snowHeight[1]; }
            if (b.snowSlopeLimit !== undefined) u.uTSnow.value.z = b.snowSlopeLimit;
            if (b.paintedSnow) u.uTPaint.value.set(b.paintedSnow[0], b.paintedSnow[1]);
            if (b.noiseScale !== undefined) u.uTNoise.value.x = b.noiseScale;
            if (b.noiseAmount !== undefined) u.uTNoise.value.y = b.noiseAmount;
            if (b.sharpness !== undefined) u.uTSharp.value = b.sharpness;
            if (b.landTint !== undefined) u.uTMacro.value = b.landTint;
            if (b.landTintFloor !== undefined) u.uTMacroMin.value = b.landTintFloor;
            if (b.landMean) u.uTMean.value.fromArray(b.landMean);
            const k = c.look || {};
            if (k.saturation !== undefined) u.uTSat.value = k.saturation;
            if (k.ambient) u.uTAmb.value.fromArray(k.ambient);
            if (k.sun !== undefined) u.uTSun.value = k.sun;
            if (c.shadowFade) u.uShFade.value.set(c.shadowFade[0], c.shadowFade[1]);
            return api;
        },
        // layer: 'grass' | 'rock' | 'snow' | 'base' (the whole-tile base normal; kind is ignored for 'base')
        setTerrainTexture(layer, kind, url, onLoad) {
            const name = key[layer][kind === 'normal' ? 1 : 0];
            if (layer !== 'base' && kind === 'normal' && lite) return null;   // lite shader has no detail normal maps
            const old = u[name].value;
            const t = load(url, () => { if (old && old !== t) old.dispose(); if (onLoad) onLoad(t); });
            u[name].value = t;
            return t;
        }
    };
    L.forEach((name) => {
        const l = cfg.layers[name];
        u[key[name][0]].value = load(l.albedo, cfg.onLoad);
        if (!lite && l.normal) u[key[name][1]].value = load(l.normal, cfg.onLoad);
    });
    const hasBase = !!(cfg.baseNormal && cfg.baseNormal.map);   // one small texture: loaded on every tier
    if (hasBase) u.uTMN.value = load(cfg.baseNormal.map, cfg.onLoad);
    api.apply(cfg);

    const prev = material.onBeforeCompile;
    material.onBeforeCompile = (sh, r) => {
        if (prev) prev(sh, r);
        Object.assign(sh.uniforms, u);
        if (fillU) Object.assign(sh.uniforms, fillU);
        sh.vertexShader = 'varying vec3 vTW; varying vec3 vTN;\n' + sh.vertexShader.replace('#include <project_vertex>',
            '#include <project_vertex>\n    vTW = (modelMatrix * vec4(transformed, 1.0)).xyz; vTN = mat3(modelMatrix) * objectNormal;');
        const decl = (lite ? '#define TSPLAT_LITE\n' : '') + (hasBase ? '#define TSPLAT_BASEN\n' : '') + `varying vec3 vTW; varying vec3 vTN;
uniform sampler2D uTMN; uniform vec4 uTMNP; uniform float uTMNMirror;
uniform sampler2D uTGA, uTRA, uTSA, uTGN, uTRN, uTSN;
uniform vec3 uTScale, uTNStr, uTTintG, uTTintR, uTTintS, uTSnow, uTMean, uTAmb;
uniform vec2 uTRock, uTPaint, uTNoise, uShCenter, uShFade; uniform float uTSharp, uTMacro, uTMacroMin, uTSun, uTSat;
float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(tHash(i), tHash(i + vec2(1, 0)), f.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), f.x), f.y); }
float tSharp(float w) { return clamp((w - 0.5) * uTSharp + 0.5, 0.0, 1.0); }
vec3 tUnpack(vec4 t, float s) { vec3 n = t.xyz * 2.0 - 1.0; n.xy *= s; return n; }
`;
        const mapCode = `
    vec4 texelColor = texture2D(map, vUv);                       // painted land map: macro tint / AO / painted snow
    vec3 tN = normalize(vTN);
#ifdef TSPLAT_BASEN
    {   // base normal: baked from the high-detail terrain over the whole tile (mesh UVs, no repeat at tiling 1).
        // Its X/Y are world X/Z slopes (flat-plane tangent space), so it replaces the coarse mesh normal on every LOD.
        vec2 bUv = vec2(mix(vUv.x, 1.0 - vUv.x, uTMNMirror), vUv.y) * uTMNP.x;
        vec3 bn = texture2D(uTMN, bUv).xyz * 2.0 - 1.0;
        vec3 bW = normalize(vec3(bn.x * uTMNP.z, max(bn.z, 0.05), bn.y * uTMNP.w));
        vec3 bM = normalize(mix(tN, bW, clamp(uTMNP.y, 0.0, 1.0)));
        bM.xz *= max(uTMNP.y, 1.0);                                // strength > 1 exaggerates the relief
        tN = normalize(bM);
    }
#endif
    float tNz = (tNoise(vTW.xz * uTNoise.x) * 0.65 + tNoise(vTW.xz * uTNoise.x * 3.8) * 0.35 - 0.5) * uTNoise.y;   // ~-0.5..0.5
    // weights
    float wR = tSharp(1.0 - smoothstep(uTRock.x, uTRock.y, tN.y + tNz * 0.08));
    float hS = smoothstep(uTSnow.x, uTSnow.y, vTW.y + tNz * 14.0);
    float pS = smoothstep(uTPaint.x, uTPaint.y, dot(texelColor.rgb, vec3(0.2126, 0.7152, 0.0722)) + tNz * 0.06);
    float wS = tSharp(max(hS * smoothstep(uTSnow.z - 0.12, uTSnow.z, tN.y + tNz * 0.1), pS));
    wS *= 1.0 - wR * 0.75;                                         // a little snow survives on rock
    wR *= 1.0 - wS;
    float wG = max(1.0 - wR - wS, 0.0);
    // albedo
    vec2 uvG = vTW.xz * uTScale.x, uvS = vTW.xz * uTScale.z;
#ifdef TSPLAT_LITE
    vec3 cR = texture2D(uTRA, vTW.xz * uTScale.y).rgb;
#else
    vec3 tw = pow(abs(tN), vec3(4.0)); tw /= (tw.x + tw.y + tw.z);
    vec3 tsg = sign(tN);
    vec2 uvRX = vTW.zy * uTScale.y * vec2(tsg.x, 1.0), uvRY = vTW.xz * uTScale.y * vec2(tsg.y, 1.0), uvRZ = vTW.xy * uTScale.y * vec2(-tsg.z, 1.0);
    vec3 cR = texture2D(uTRA, uvRX).rgb * tw.x + texture2D(uTRA, uvRY).rgb * tw.y + texture2D(uTRA, uvRZ).rgb * tw.z;
#endif
    vec3 tAlb = pow(texture2D(uTGA, uvG).rgb, vec3(2.2)) * uTTintG * wG + pow(cR, vec3(2.2)) * uTTintR * wR
              + pow(texture2D(uTSA, uvS).rgb, vec3(2.2)) * uTTintS * wS;          // sRGB-authored layers -> linear
    tAlb = mix(vec3(dot(tAlb, vec3(0.2126, 0.7152, 0.0722))), tAlb, uTSat);
    vec3 tMac = clamp(texelColor.rgb / uTMean, vec3(uTMacroMin), vec3(2.2));
    tMac = mix(vec3(1.0), tMac, uTMacro * (1.0 - wS * 0.7));
    diffuseColor.rgb *= tAlb * tMac;
`;
        const nrmCode = `
#ifdef TSPLAT_LITE
    normal = normalize((viewMatrix * vec4(tN, 0.0)).xyz);
#else
    {
        vec3 nG = tUnpack(texture2D(uTGN, uvG), uTNStr.x), nS = tUnpack(texture2D(uTSN, uvS), uTNStr.z);
        nG = normalize(vec3(nG.xy + tN.xz, nG.z * tN.y)).xzy;      // whiteout, top projection
        nS = normalize(vec3(nS.xy + tN.xz, nS.z * tN.y)).xzy;
        vec3 nX = tUnpack(texture2D(uTRN, uvRX), uTNStr.y), nY = tUnpack(texture2D(uTRN, uvRY), uTNStr.y), nZ = tUnpack(texture2D(uTRN, uvRZ), uTNStr.y);
        nX.x *= tsg.x; nY.x *= tsg.y; nZ.x *= -tsg.z;
        nX = vec3(nX.xy + tN.zy, abs(nX.z) * tN.x);
        nY = vec3(nY.xy + tN.xz, abs(nY.z) * tN.y);
        nZ = vec3(nZ.xy + tN.xy, abs(nZ.z) * tN.z);
        vec3 nR = normalize(nX.zyx * tw.x + nY.xzy * tw.y + nZ.xyz * tw.z);
        vec3 nW = normalize(nG * wG + nR * wR + nS * wS);
        normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
    }
#endif
`;
        // sun shadows fade out toward the edge of the (tight, plane-following) shadow frustum
        const lightsBegin = THREE.ShaderChunk.lights_fragment_begin.replace(
            'getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] )',
            'mix( 1.0, getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ), uShStr * (1.0 - tShFade) )');
        sh.fragmentShader = FILL_DECL + decl + sh.fragmentShader
            .replace('#include <map_fragment>', mapCode)
            .replace('#include <normal_fragment_maps>', nrmCode)
            .replace('#include <lights_fragment_begin>', 'float tShFade = smoothstep(uShFade.x, uShFade.y, distance(vTW.xz, uShCenter));\n' + lightsBegin)
            .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n    reflectedLight.indirectDiffuse *= uTAmb; reflectedLight.directDiffuse *= uTSun;' + fillGLSL('1.0'));
    };
    material.needsUpdate = true;
    material.userData.terrainSplat = api;
    return api;
}
