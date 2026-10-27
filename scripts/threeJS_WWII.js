import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.117.1/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RGBELoader } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/loaders/RGBELoader.js';
import { TerrainTiler } from './TerrainTiler.js';
import { PropSpawner } from './PropSpawner.js';
import { CalmCamera } from './CalmCamera.js';
import { createGradePass, sampleHorizon, addCloudShadows, toneMapACES, addSkyFog, createSkyMesh, addTerrainSplat, createFill, FILL_DECL, fillGLSL } from './HeroFX.js';
import { WingtipTrail } from './WingtipTrail.js';
import { FlightController } from './flightcontroller.js';
import { SunFlare } from './SunFlare.js';
import { LowClouds } from './LowClouds.js';
import { DRACOLoader } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/loaders/DRACOLoader.js';

// --- Hero loading overlay hooks (index.html #hero-loader listens; harmless without it) ---
// window 'herofx:progress' (detail 0..1): files via THREE.DefaultLoadingManager (GLB / textures / HDR / Draco)
// blended with the scene milestones below; 'herofx:ready' once every milestone is in, no file is pending and
// HERO_READY_FRAMES real frames have been drawn (the first frames compile shaders / upload textures).
const HERO_STEPS = ['sky', 'terrain', 'plane', 'trees', 'buildings'], HERO_READY_FRAMES = 2;
const heroLoad = { done: new Set(), items: 0, total: 0, frames: 0, ready: false };
function heroEmit(type, detail) { window.dispatchEvent(new CustomEvent(type, { detail })); }
function heroProgress() {
    const files = heroLoad.total ? heroLoad.items / heroLoad.total : 0;
    heroEmit('herofx:progress', 0.5 * files + 0.5 * heroLoad.done.size / HERO_STEPS.length);
}
function heroStep(name) { heroLoad.done.add(name); heroProgress(); }
THREE.DefaultLoadingManager.onProgress = (url, loaded, total) => { heroLoad.items = loaded; heroLoad.total = total; heroProgress(); };
heroProgress();
function heroFrame() {   // called after every real composer.render()
    if (heroLoad.ready || heroLoad.done.size < HERO_STEPS.length || heroLoad.items < heroLoad.total) return;
    if (++heroLoad.frames < HERO_READY_FRAMES) { if (isPaused) requestStillFrame(); return; }
    heroLoad.ready = true;
    heroEmit('herofx:progress', 1); heroEmit('herofx:ready');
}

// --- Scene Setup ---
const container = document.getElementById('show-screen');
let w = container.clientWidth;
let h = container.clientHeight;


const scene = new THREE.Scene();

// Device tier: phones / small screens / low memory get fewer clouds, DPR 1.
const IS_COARSE_POINTER = window.matchMedia('(pointer: coarse)').matches;
const IS_LOW_TIER = IS_COARSE_POINTER || Math.min(window.innerWidth, window.innerHeight) < 600 ||
    (navigator.deviceMemory !== undefined && navigator.deviceMemory <= 4);

// Sky-matched linear haze: colour is replaced by the HDR's horizon colour once the sky loads.
// The far plane sits just past FOG_FAR (everything beyond is fully hazed anyway) to cut draw cost.
// Terrain tiles (5x5 x 1042) are spawned/removed as the plane crosses cells; the nearest newly spawned
// edge can be ~2080 units away in ANY direction, so the haze must be fully opaque before that radius.
const FOG_NEAR = 300, FOG_FAR = 1700;
// r117 fog uses view depth (-mvPosition.z), which is much smaller than the true distance toward the sides of a
// wide / off-centre (setViewOffset) frustum, so side tiles popped in un-fogged. Use radial distance instead.
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n\tfogDepth = length( mvPosition.xyz );\n#endif';
scene.fog = new THREE.Fog(0x959999, FOG_NEAR, FOG_FAR);

// =============================================================================================================
// SCENE CONFIG: props and terrain look. Everything here can also be changed at runtime:
//   props.setChance('trees' | 'buildings', 0..1)          terrainSplat.apply({ blend: { ... }, layers: { ... } })
//   terrainSplat.setTerrainTexture('grass' | 'rock' | 'snow' | 'base', 'albedo' | 'normal', url)
// =============================================================================================================
const LIGHTING = {
    // Hemisphere fill: lifts shadowed / sun-facing-away areas with sky light from above and warm bounce from below.
    fillSky: 'auto',              // 'auto' = hue of the HDR sky overhead (average, luminance-normalised), or a colour
    autoSkyBand: 0.25,            // auto: rows from the zenith down to this fraction of the HDR (0.25 = above ~45 deg)
    autoSkySaturation: 0.4,       // auto: 1 = the sky's own hue, 0 = neutral white
    fillSkyFallback: 0x9db4d6,    // used until the HDR has loaded (auto mode)
    fillGround: 0x9a5a2a,         // warm ground bounce (lit from below)
    fillIntensity: 0.28,          // fill strength (0 = off, as before)
    propFill: 1.25,               // extra multiplier for trees / buildings (their dense canopies read darker)
    shadowStrength: 2.5          // 0..1: how much sun the shadow map removes (1 = full, as before)
};
const PROPS = {
    spawnDistance: 1500,          // props show within this distance of the plane (fog runs 300 -> 1700)
    buffer: 200,                  // ...and hide beyond spawnDistance + buffer (hysteresis)
    interval: 0.5,                // seconds between distance checks
    treeSpawnChance: 1.0,         // 0..1, fraction of tree points used (stable per point and tile: hashed)
    buildingSpawnChance: 1.0,     // 0..1, fraction of building points used
    randomRotation: true,         // random (hashed, stable) rotation around Y for every tree and building
    treeScaleJitter: 0.15,        // trees: +-15% extra scale on top of the Blender point scale (0 = off)
    buildingScaleJitter: 0,
    buildingTint: 0.7,            // 1 = original building texture, lower = darker
    trunkTint: 0.4,               // 1 = original trunk colour, lower = darker
    // relative frequency per variant (variants are sorted by object name; undefined = all equal)
    treeWeights: [1, 1, 1],                 // Tree_01, Tree_02, Tree_03
    buildingWeights: [3, 0.6, 4, 5, 0.6],   // Big_House, Church, Medium_House, Small_House, Tower
    sink: { trees: 0.6, buildings: 0.4 },   // metres pushed into the ground (covers small terrain mismatches)
    // Tree LODs (assets/models/props/trees_lod.glb, Tree_LODs_Tree_01..03 -> Tree_01..03 by name): cross-card trees
    // beyond treeLodDistance, the full tree inside it. Runtime: props.setLod('trees', distance, buffer).
    treeLodDistance: 550,         // metres from the plane: full tree inside, LOD card beyond (+ buffer); -1 = no LODs
    treeLodBuffer: 40,            // hysteresis: a full tree turns LOD only past treeLodDistance + treeLodBuffer
    treeLodTint: [1.75, 1.3, 1.0], // LOD foliage colour multiplier, number or [r, g, b] (1 = as baked; matched to the full
                                  // trees' warmer leaf texture); the LOD trunk follows trunkTint
    treeLodNormalUp: 2.0,         // bends the cards' in-plane rounded normals toward world up, like the full trees' foliage
    treeLodNormalView: 0.3,       // ...and toward the viewer (sphere-like canopy); both 0 = normals exactly as authored
    trees:     { points: 'assets/models/spawn_trees.glb',     filter: /tree/i,           meshes: 'assets/models/props/trees.glb',
                 lods: 'assets/models/props/trees_lod.glb' },
    buildings: { points: 'assets/models/spawn_buildings.glb', filter: /house|building/i, meshes: 'assets/models/props/buildings.glb' }
};
const TERRAIN = {
    lite: IS_LOW_TIER,            // low tier: albedo only, rock on world XZ (3 detail lookups instead of 10)
    layers: {
        // tiling = metres per texture repeat; tint is multiplied in (linear), brightness scales it
        grass: { albedo: 'assets/texture/terrain/grass_albedo.jpg', normal: 'assets/texture/terrain/grass_normal.jpg',
                 tiling: 22, normalStrength: 1.0, tint: 0xffffff, brightness: 1.0 },
        rock:  { albedo: 'assets/texture/terrain/rock_albedo.jpg',  normal: 'assets/texture/terrain/rock_normal.jpg',
                 tiling: 34, normalStrength: 1.0, tint: 0xffffff, brightness: 1.0 },
        snow:  { albedo: 'assets/texture/terrain/snow_albedo.jpg',  normal: 'assets/texture/terrain/snow_normal.jpg',
                 tiling: 40, normalStrength: 1.0, tint: 0xffffff, brightness: 0.75 }
    },
    // Base normal: baked from the high-detail terrain, covers one whole tile (mesh UVs). Replaces the coarse
    // mesh normal on every LOD (LOD1 gains the full-detail shape); the layer detail normals blend on top.
    // Loaded on all tiers (one 256 px JPG, 1 lookup). Orientation verified against the mesh normals:
    // sampled with U mirrored, red -> -X, green -> -Z.
    baseNormal: { map: 'assets/texture/terrain/terrain_normal.jpg', tiling: 1, strength: 0.5,
                  mirrorU: true, flipRed: true, flipGreen: true },   // (if a larger bake arrives, downsample to ~512)
    // Whole-tile land colour map (green grass + dark rocky/earth veins), mapped once per tile with the mesh UVs.
    // 1024 px JPG (from a 2048 px PNG). Its edges wrap, so neighbouring tiles join without seams; its dark veins
    // follow the steep slopes when U is mirrored (like baseNormal; checked against terrain_normal.jpg).
    // Used as a tint ratio around its mean colour, so the grass/rock/snow layers keep their own detail.
    landMap: { map: 'assets/texture/terrain/terrain_color.jpg', mirrorU: true,
               contrast: 1.3,                     // >1 deepens the map's light/dark patches, <1 flattens them
               mean: [0.2453, 0.2620, 0.1640] },  // its mean colour (raw texel values, as sampled: keeps the tint centred on 1)
    blend: {
        rockSlope: [0.74, 0.90],  // world normal.y (base normal included): fully rock below the first value, no rock above the second
        // Snow: fbm cloud noise + a coverage bias that rises with height, cut at snowCutoff -> chunky patches
        // with crisp edges. Isolated patches near snowHeight[0], mostly covered by snowHeight[1].
        snowHeight: [42, 68],     // height band over which the coverage bias ramps (terrain spans ~1-70); none well below [0]
        snowHeightBias: [-0.2, 0.22],    // bias added to the noise (~0..1) at snowHeight[0] / [1]: raise = more snow
        snowNoiseScale: 0.035,    // 1 / metres of the snow noise (smaller = bigger patches, ~30 m blobs at 0.035)
        snowNoiseOctaves: 5,      // fbm octaves, 1-6 (lite / low tier capped at 3); more = more ragged edges
        snowCutoff: 0.5,          // noise + bias above this is snow
        snowEdge: 0.02,           // half-width of the edge in noise units: smaller = crisper (widens with distance)
        snowSlopeLimit: 0.88,     // snow only sticks where normal.y is above this (flatter ground)
        paintedSnow: [9, 10],     // land-map luminance read as painted snow (off: the colour map has no snow)
        noiseScale: 0.045,        // 1 / metres of the rock-blend breakup noise (second octave is 3.8x finer)
        noiseAmount: 1.0,         // 0 = clean bands, 1 = default breakup
        sharpness: 1.0,           // 1 = as authored, >1 = harder layer edges, <1 = softer
        landTint: 0.9,            // how much of the land colour map tints/shades the layers (0..1)
        landTintFloor: 0.45       // darkest the land colour map may shade
    },
    look: {
        saturation: 0.5,          // layer albedo saturation (keeps the land map's olive tones in charge)
        ambient: [0.17, 0.15, 0.14],      // scale on the ambient light for terrain + props
        sun: 0.85                 // scale on the sun for terrain + props
    }
};

// Depth precision (scene renders into 24-bit depth composer targets, see the composer below).
// Was a fixed near of 0.1 (far/near 24650 + 16-bit depth: z-fighting on props).
// - Desktop: fixed small near (desktopNear) so the wingtip vapour trails streaming past the camera are never
//   clipped; 24-bit depth keeps houses/trees clean out to the fog (~1 mm steps at 100 m, ~1.5 cm at 500 m).
// - Low tier (phones): near follows the chase camera's clearance to the aircraft (the closest geometry),
//   near = clamp((camera-to-aircraft distance - aircraft radius) * nearFraction, nearMin, nearMax).
//   Trails are off there by default (trailsOnMobile), so nothing streams past the camera to be cut.
const DEPTH = {
    desktopNear: 1.0,
    nearMin: 1.5, nearMax: 8, nearFraction: 0.7,   // low tier dynamic near
    far: FOG_FAR * 1.45,                           // well past full haze; sky background is never clipped
    trailsOnMobile: false                          // wingtip vapour trails on the low tier (off: saves 2 ribbons/frame)
};
const DYNAMIC_NEAR = IS_LOW_TIER;
const camera = new THREE.PerspectiveCamera(60, w / h, DYNAMIC_NEAR ? DEPTH.nearMin : DEPTH.desktopNear, DEPTH.far);
let planeRadius = 0;   // aircraft bounding radius around its origin (set once it loads)
function updateNearPlane() {
    if (!DYNAMIC_NEAR || !planeRadius) return;
    const d = camera.position.distanceTo(spitfire.position) - planeRadius;
    const n = Math.min(DEPTH.nearMax, Math.max(DEPTH.nearMin, d * DEPTH.nearFraction));
    if (Math.abs(n - camera.near) > camera.near * 0.08) { camera.near = n; camera.updateProjectionMatrix(); }
}
camera.position.set(-20, 100, -100); // Initial offset position relative to the plane height


const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.46;
// Lower DPR cap on low-tier devices to keep phones cool.
const MAX_DPR = IS_LOW_TIER ? 1 : 2;
const reduceMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
function currentDPR() { return Math.min(window.devicePixelRatio || 1, MAX_DPR); }
renderer.setPixelRatio(currentDPR());
renderer.setSize(w, h);
container.appendChild(renderer.domElement);

// --- Orbit Controls ---
// const controls = new OrbitControls(camera, renderer.domElement);
// controls.enableDamping = true;
// controls.dampingFactor = 0.3;
// controls.maxDistance = 10; // Pin the camera's zoom distance close to the aircraft
// controls.minDistance = 3;

// --- Lighting & Environment Probe ---
// Sun direction (toward the sun). sunLight itself follows the plane so its shadow frustum stays tight;
// everything that only needs the direction (flare, clouds, grade glow, propeller) uses SUN_POS.
const SUN_POS = new THREE.Vector3(100, 30, 100);
const SUN_DIR = SUN_POS.clone().normalize();
const sunLight = new THREE.DirectionalLight(0xffb066, 2.4); // golden-orange sunset sun (was 0xffc98f, 2.2)
sunLight.position.copy(SUN_POS);
scene.add(sunLight); scene.add(sunLight.target);

// --- Sun shadows (desktop tier only; dropped automatically if the frame rate can't hold ~45 fps) ---
// One 1024 PCFSoft map, orthographic box 2*SHADOW_HALF wide centred a little ahead of the plane, snapped to
// shadow texels so it doesn't shimmer as it follows. Terrain receives; the plane and props cast.
const SHADOW_HALF = 420, SHADOW_AHEAD = 220, SHADOW_DIST = 700;
const shadows = { supported: !IS_LOW_TIER, on: false, reenables: 0, good: 0 };
renderer.shadowMap.enabled = shadows.supported;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
if (shadows.supported) {
    const sc = sunLight.shadow.camera;
    sc.left = sc.bottom = -SHADOW_HALF; sc.right = sc.top = SHADOW_HALF; sc.near = 50; sc.far = SHADOW_DIST + 400;
    sc.updateProjectionMatrix();
    sunLight.shadow.mapSize.set(1024, 1024);
    sunLight.shadow.bias = -0.0008;
    setShadows(true);
}
function setShadows(on) {
    on = on && shadows.supported;
    if (shadows.on === on) return;
    shadows.on = on;
    sunLight.castShadow = on;            // changes the lights hash: three switches every lit material's program (cached after the first time)
}

// --- Sun Flare ---
const sunFlare = new SunFlare(scene, { position: SUN_POS }, { distance: 5000, size: 500 });
// Fewer, bigger, denser puffs, wrapped around a point AHEAD of the camera so nearly all of them are in view.
const lowClouds = new LowClouds(scene, { count: IS_LOW_TIER ? 35 : 60, minY: 110, maxY: 230, radius: 700, aheadFactor: 0.6,
    minSize: 180, maxSize: 340, opacity: 0.38, sunDir: SUN_POS, fogNear: FOG_NEAR, fogFar: FOG_FAR });

// Ambient light to act as uniform Ambient Occlusion fill across shadowed areas
const ambientAO = new THREE.AmbientLight(0xc8b49a, 2.2); // warm fill for shadows (was cool 0x93dcf5, 2.4)
scene.add(ambientAO);

const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();

// Sky shared with the per-pixel sky fog (terrain + trees)
const skyTexUniform = { value: null }, skyReadyUniform = { value: 0 };
// HalfFloat (linear) instead of RGBE bytes: RGBE cannot be filtered/interpolated, which made the
// PMREM-as-background sky render as hard faceted triangles of different colours.
const hdriLoader = new RGBELoader().setDataType(THREE.HalfFloatType);
// Sky resolution: 1024x512 on desktop (sharp sky), 512x256 on the low tier.
const SKY_HDR = IS_LOW_TIER ? 'assets/texture/hdri/modified_SKY_lite_ultra.hdr' : 'assets/texture/hdri/modified_SKY_lite.hdr';
hdriLoader.load(SKY_HDR, (texture) => {
    // match fog to the sky's horizon colour (linear, same tone mapping as the sky)
    // (r117 applies fog after tone mapping, so tone-map the sampled HDR colour the same way the sky is)
    if (sampleHorizon(texture, scene.fog.color)) {
        toneMapACES(scene.fog.color, renderer.toneMappingExposure);
        lowClouds.setFog(scene.fog.color, FOG_NEAR, FOG_FAR);
    }
    fill.setSkyFromTexture(texture);   // fill's sky hue = the sunset sky's upper-hemisphere average
    const envMap = pmremGenerator.fromEquirectangular(texture).texture;
    scene.environment = envMap;      // Reflection probe for PBR materials
    // Sky: the equirect itself, bilinear-filtered at full source resolution (no cube conversion / resampling),
    // shared by the sky mesh and the per-pixel sky fog. Kept alive (not disposed).
    texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = false;
    texture.wrapS = THREE.RepeatWrapping;   // no seam at the azimuth wrap
    texture.needsUpdate = true;
    skyTexUniform.value = texture; skyReadyUniform.value = 1;
    scene.add(createSkyMesh(camera, skyTexUniform));   // drawn first; replaces scene.background
    pmremGenerator.dispose();
    heroStep('sky');
    requestStillFrame();
});

// --- Post Processing Stack (Bloom) ---
// Composer targets: HalfFloat where renderable (desktop), so the linear-light intermediate image doesn't band
// in the darks; 8-bit on the low tier. The final grade pass adds dither either way.
// Depth: the scene is drawn into these targets, not the canvas. r117 gives a depth-only render target a
// DEPTH_COMPONENT16 renderbuffer (16-bit: the z-fighting); with stencilBuffer it allocates a packed
// DEPTH_STENCIL renderbuffer instead (DEPTH24_STENCIL8: WebGL2 core, WebGL1 via packed depth-stencil),
// i.e. 24-bit depth on every tier, no depth-texture extension needed. (Composer clones it for target 2.)
const gl2 = renderer.capabilities.isWebGL2;
const halfOK = !IS_LOW_TIER && (gl2 ? !!renderer.extensions.get('EXT_color_buffer_float') : !!renderer.extensions.get('EXT_color_buffer_half_float'));
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(w * currentDPR(), h * currentDPR(), {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat,
    type: halfOK ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: true, stencilBuffer: true }));
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);


const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(w, h),
    0.15,  // strength
    0.5,   // radius: tight glow, no whole-frame veil
    0.62   // threshold (tone-mapped luminance): only the sunlit cloud rims / highlights glow
);
// Bloom tint (warm red-orange sunset glow): UnrealBloomPass multiplies each mip by bloomTintColors[i] in its
// composite shader (uniform values only, zero extra cost).
const bloomTint = new THREE.Color(0xff7a5a);
for (let i = 0; i < bloomPass.bloomTintColors.length; i++) bloomPass.bloomTintColors[i].set(bloomTint.r, bloomTint.g, bloomTint.b);
composer.addPass(bloomPass);

// Final pass: golden-hour grade + vignette (single full-screen pass)
const gradePass = createGradePass({ warm: 0xffb27a, split: 0.3, contrast: 1.06, saturation: 1.1, lift: 0.025, vignette: 0.25,
    sunGlow: 0.35, sunGlowColor: 0xff9850 });   // warm sunset grade + broad golden glow toward the sun
gradePass.setAspect(w / h);
composer.addPass(gradePass);


const textureLoader = new THREE.TextureLoader();
// Color (albedo) textures are authored in sRGB; pass isColor=false for data maps.
function LoadTexture(path, isColor = true){
    const texture = textureLoader.load(path, requestStillFrame);
    texture.flipY = false;
    if (isColor) texture.encoding = THREE.sRGBEncoding;
    return texture;
}

// --- GLTF Asset Asset Loading ---
const gltfLoader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.117.1/examples/js/libs/draco/gltf/');
gltfLoader.setDRACOLoader(dracoLoader);
let spitfire = null;
const aircraftHeight = 80.0; // Fixed elevation above 0,0,0 coordinate platform


// tiling handler
let terrainTiler = new TerrainTiler(scene, {
    tileSize: 1042, // matches the terrain mesh size
    gridSize: 4     // 4 -> 5x5 tile pool (2 tiles each side of the plane's cell)
});

// Terrain is only shown once BOTH the glb and its colour map are ready (avoids an untextured-grey frame then a pop).
let landMapReady = false, pendingTerrain = null;
const landMap = textureLoader.load(TERRAIN.landMap.map, () => {
    landMapReady = true;
    if (pendingTerrain) { terrainTiler.init(pendingTerrain); pendingTerrain = null; heroStep('terrain'); }
    requestStillFrame();
});
landMap.flipY = false;

// --- Fill light (settings: LIGHTING above; runtime: fill.apply({ fillIntensity: .. }), propFillUniform.value) ---
const fill = createFill(LIGHTING);
const propFillUniform = { value: LIGHTING.propFill };

// --- Terrain: procedural grass / rock / snow on top of the painted land map (settings: TERRAIN above) ---
const landMaterial = new THREE.MeshPhongMaterial({ color: 0xffffff, map: landMap, specular: 0x000000, shininess: 1 });
// scrolling cloud shadows (drift with the LowClouds wind), then the splat, then the sky-matched fog
addCloudShadows(landMaterial, { windOffset: lowClouds.uniforms.uWindOff.value, scale: 1 / 900, strength: 0.25 });
const terrainSplat = addTerrainSplat(landMaterial, Object.assign({ onLoad: requestStillFrame, fill, shadowFade: [SHADOW_HALF * 0.7, SHADOW_HALF * 0.97] }, TERRAIN));
addSkyFog(landMaterial, skyTexUniform, skyReadyUniform);

gltfLoader.load('assets/models/land_03_draco.glb', (gltf) => {
    const landLODs = new Array(5);
    gltf.scene.traverse((child) => {
        if (!child.isMesh || !child.name.startsWith('Landscape_LOD')) return;
        child.material = landMaterial;
        child.receiveShadow = true;
        const k = +child.name.slice(13);
        if (k >= 0 && k < 5) landLODs[k] = child;
    });
    if (!landLODs[0] || !landLODs[1]) {
        console.error('Terrain: Landscape_LOD0 / Landscape_LOD1 missing from land_03_draco.glb');
        return;
    }
    if (landMapReady) { terrainTiler.init(landLODs); heroStep('terrain'); } else pendingTerrain = landLODs;
    requestStillFrame();
});

// --- Props: trees + buildings on the Blender spawn points, repeated per terrain tile (settings: PROPS above) ---
// Same lighting balance as the terrain (scaled sun / ambient), cloud shadows and sky fog.
const props = new PropSpawner(scene, { tileSize: 1042, spawnDistance: PROPS.spawnDistance, buffer: PROPS.buffer, interval: PROPS.interval,
    castShadow: shadows.supported, receiveShadow: false });
function decorateProp(mat) {
    addCloudShadows(mat, { windOffset: lowClouds.uniforms.uWindOff.value, scale: 1 / 900, strength: 0.25 });
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
        prev(sh, r);
        sh.uniforms.uTAmb = terrainSplat.uniforms.uTAmb; sh.uniforms.uTSun = terrainSplat.uniforms.uTSun;
        Object.assign(sh.uniforms, fill.uniforms); sh.uniforms.uPropFill = propFillUniform;
        sh.fragmentShader = FILL_DECL + 'uniform vec3 uTAmb; uniform float uTSun, uPropFill;\n' + sh.fragmentShader.replace('#include <lights_fragment_end>',
            '#include <lights_fragment_end>\n    reflectedLight.indirectDiffuse *= uTAmb; reflectedLight.directDiffuse *= uTSun;' + fillGLSL('uPropFill'));
    };
    addSkyFog(mat, skyTexUniform, skyReadyUniform);
}
// LOD cards: the baked trunk texels are keyed to pure grey (see trees_lod.glb), recoloured here with the full trees'
// trunk colour (same Color object, so trunkTint and runtime changes apply to both); foliage scaled by treeLodTint.
// The cards' rounded normals lie in the card plane (lower half facing down), while the full trees' foliage normals
// mostly face up (mean n.y ~0.9) and outward: bent toward world up / the viewer (treeLodNormalUp / View) so both
// light alike from any side.
const lodTrunkUniform = { value: new THREE.Color(0x3a2a24) }, lodTintUniform = { value: new THREE.Vector3().fromArray(Array.isArray(PROPS.treeLodTint) ? PROPS.treeLodTint : [PROPS.treeLodTint, PROPS.treeLodTint, PROPS.treeLodTint]) }, lodBendUniform = { value: new THREE.Vector2(PROPS.treeLodNormalUp, PROPS.treeLodNormalView) };
function lodTreeMaterial(m) {
    const p = PropSpawner.toPhong(m, 0.5);
    decorateProp(p); p.userData.__propDecorated = true;
    const prev = p.onBeforeCompile;
    // own outermost function (three r117 keys shader programs by onBeforeCompile source): not shared with leaves
    p.onBeforeCompile = function lodTreeCompile(sh, r) {
        prev(sh, r);
        sh.uniforms.uLodTrunk = lodTrunkUniform; sh.uniforms.uLodTint = lodTintUniform; sh.uniforms.uLodBend = lodBendUniform;
        sh.fragmentShader = 'uniform vec3 uLodTrunk, uLodTint; uniform vec2 uLodBend;\n' + sh.fragmentShader.replace('#include <normal_fragment_maps>',
            '#include <normal_fragment_maps>\n    normal = normalize(normal + normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz) * uLodBend.x + normalize(vViewPosition) * uLodBend.y);').replace('#include <map_fragment>',
            '#include <map_fragment>\n    { float lmx = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)), lmn = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));\n' +
            '      float ltk = 1.0 - smoothstep(0.03, 0.08, (lmx - lmn) / max(lmx, 1e-4));\n' +
            '      diffuseColor.rgb = mix(diffuseColor.rgb * uLodTint, uLodTrunk * clamp(lmx / 0.25, 0.4, 1.2), ltk); }');
    };
    return p;
}
// map LOD variants onto the full variants by their Tree_NN suffix (sorted order if the names don't pair up)
function matchLods(full, lods) {
    const key = (n) => { const mt = /tree[_\-\s.]*0*(\d+)\s*$/i.exec(n || ''); return mt ? +mt[1] : null; };
    const out = full.map((v) => { const k = key(v.name); return lods.find((l) => k !== null && key(l.name) === k) || null; });
    if (out.some((x) => !x) && lods.length === full.length) {
        console.warn('PropSpawner: tree LOD names do not match, mapping by sorted order');
        return lods.slice();
    }
    return out;
}
function spawnSet(name) {
    const c = PROPS[name], isTree = name === 'trees';
    const points = PropSpawner.loadPoints(gltfLoader, c.points, c.filter, c.points.replace(/\.glb$/, '.json'))
        .catch((e) => { console.warn('PropSpawner: ' + name + ' points unavailable, using placeholders', e); return PropSpawner.placeholderPoints(isTree ? 400 : 50, 1042, name.length); });
    let realMeshes = true;
    const meshes = PropSpawner.loadVariants(gltfLoader, c.meshes, { sink: PROPS.sink[name], material: (m) => { const p = PropSpawner.toPhong(m, 0.5); if (!isTree) p.color.multiplyScalar(PROPS.buildingTint); else if (!p.map) p.color.multiplyScalar(PROPS.trunkTint); return p; } })
        .then((v) => { if (!v.length) throw new Error('no meshes in ' + c.meshes); return v; })
        .catch((e) => { realMeshes = false; console.warn('PropSpawner: ' + name + ' meshes unavailable, using placeholders', e); return PropSpawner.placeholderVariants(name); });
    // LODs are optional: if the file fails, the full trees are used at every distance (as before)
    const lods = c.lods ? PropSpawner.loadVariants(gltfLoader, c.lods, { sink: PROPS.sink[name], material: lodTreeMaterial })
        .then((v) => { if (!v.length) throw new Error('no meshes in ' + c.lods); return v; })
        .catch((e) => { console.warn('PropSpawner: ' + name + ' LODs unavailable, using full meshes at all distances', e); return null; }) : Promise.resolve(null);
    Promise.all([points, meshes, lods]).then(([pts, variants, lodVariants]) => {
        let lod = null;
        if (lodVariants && realMeshes && PROPS.treeLodDistance >= 0) {
            const trunk = variants.map((v) => v.parts.find((pt) => !pt.material.map)).find(Boolean);
            if (trunk) lodTrunkUniform.value = trunk.material.color;
            lod = { variants: matchLods(variants, lodVariants), distance: PROPS.treeLodDistance, buffer: PROPS.treeLodBuffer };
        }
        props.addSet(name, pts, variants, decorateProp, {
            chance: isTree ? PROPS.treeSpawnChance : PROPS.buildingSpawnChance,
            randomRotation: PROPS.randomRotation,
            scaleJitter: isTree ? PROPS.treeScaleJitter : PROPS.buildingScaleJitter,
            weights: variants.length === (isTree ? PROPS.treeWeights : PROPS.buildingWeights).length ? (isTree ? PROPS.treeWeights : PROPS.buildingWeights) : null,
            lod
        });
        if (spitfire) props.update(spitfire.position, 0, true);
        heroStep(name);
        requestStillFrame();
    });
}
spawnSet('trees');
spawnSet('buildings');


function createPropellerShader() {
    return new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false, // Prevents depth-sorting glitches with clouds/vapor
        uniforms: {
            // Adjust this vector to change where the sun hits the prop
            uLightDir: { value: new THREE.Vector2(1.0, 1.0).normalize() }, 
            uBaseColor: { value: new THREE.Color(0x111111) }, // Dark prop color
            uHighlightColor: { value: new THREE.Color(0xfffaed) }, // Matches your sunLight
            uOpacity: { value: 0.5 } // How transparent the fast-moving blur is
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec2 uLightDir;
            uniform vec3 uBaseColor;
            uniform vec3 uHighlightColor;
            uniform float uOpacity;
            
            varying vec2 vUv;

            void main() {
                // 1. Find the direction from the center of the UV (0.5, 0.5) to this pixel
                vec2 center = vec2(0.5, 0.5);
                vec2 dir = vUv - center;
                
                // 2. Calculate the distance from center (creates the circular cutoff)
                float radius = length(dir);
                if (radius > 0.5) discard; // Cuts the square quad into a perfect circle
                
                // Normalize the direction vector
                vec2 pixelDir = normalize(dir);
                
                // 3. The Anisotropic Math (Dot Product)
                // We compare the pixel's direction to the sun's direction.
                // Using abs() creates the symmetrical "bow-tie" shape on both sides of the center.
                float alignment = abs(dot(pixelDir, uLightDir));
                
                // 4. Sharpen the highlight
                // Raising it to a high power makes the shine narrow and sharp
                float shine = pow(alignment, 30.0); 
                
                // 5. Add subtle radial noise to simulate speed/blur (Optional but looks great)
                float speedBlur = fract(sin(dot(pixelDir, vec2(12.9898, 78.233))) * 43758.5453);
                shine += speedBlur * 0.1;

                // 6. Mix the dark base color with the bright sun highlight
                vec3 finalColor = mix(uBaseColor, uHighlightColor, shine);
                
                // Fade out the edges slightly for a softer blur
                float edgeFade = smoothstep(0.5, 0.4, radius);

                gl_FragColor = vec4(finalColor, uOpacity * edgeFade);
            }
        `
    });
}

let vapourTrails = [];

// Wingtip vapour: camera-facing ribbon from a fixed ring buffer (see WingtipTrail.js)
function CreateTrail(trailTarget, width = 0.09) {
    if (IS_LOW_TIER && !DEPTH.trailsOnMobile) return;   // phones: no trails (not created, never updated)
    vapourTrails.push(new WingtipTrail(scene, trailTarget, { width, maxPoints: 22, segmentLength: 1.3 })); // ~28 m, fades out
}


let flightController = null;
let cameraController = null;
let propMaterial = null;
let propellerMesh = null;

const spitfireAlbedo = LoadTexture('assets/texture/spitfire_albedo_01.gif', false);
// Load Aircraft Mesh
gltfLoader.load('assets/models/spitfire.glb', (gltf) => {
    spitfire = gltf.scene;

    // --- PROPELLER BLUR SETUP ---
    spitfire.traverse((child) => {
        // Find the newly separated propeller mesh
        if (child.isMesh && child.name === 'Propeller') { 
            
            // Overwrite its default Blender material entirely with your custom shader
            propMaterial = createPropellerShader(); // 1. Save to global variable
            child.material = propMaterial;          // 2. Assign to the mesh
            propellerMesh = child;                  // 3. Save the mesh reference
        }
        else {
            if (child.isMesh) {
                child.castShadow = true;
                // body: keep the model's material, just give it the texture back
                child.material.map = spitfireAlbedo;
                child.material.color.set(0xffffff);   // so the texture isn't tinted
                child.material.needsUpdate = true;
            }
            if (child.name == 'trail_l' || child.name == 'trail_r') {
                CreateTrail(child, 0.12);
            }
        }
    });

    // ... The rest of your setup ...
    spitfire.position.set(0, aircraftHeight, 0);
    let scale = 1;
    spitfire.scale.set(scale, scale, scale);
    scene.add(spitfire);
    {   // rotation-proof bounding radius about the origin (all 8 box corners), for the dynamic near plane
        spitfire.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(spitfire), c = new THREE.Vector3();
        for (let k = 0; k < 8; k++) {
            c.set(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z);
            planeRadius = Math.max(planeRadius, c.distanceTo(spitfire.position));
        }
    }

flightController = new FlightController(spitfire, {
    minY: 70,          // keep above the ~70 m peaks
    maxY: 200,
    baseSpeed: 50.0,
    maxClimb: 0.7,    // steeper dives and climbs (about 26°)
    altSpeed: 10.5,     // how often it dips and climbs
    pitchResponse: 8.8, // how quickly it noses up or down
    rollResponse: 6.0,  // how quickly it banks left or right
    turnFrequency: 1.0,  // how often it changes direction
    startHeading: Math.atan2(SUN_POS.x, SUN_POS.z),
});

    cameraController = new CalmCamera(camera, spitfire, flightController);
    cameraController.setFrame(w, h);


    //CreateTrail(spitfire);
    heroStep('plane');
    requestStillFrame();
});

// Setup Trail




// --- Responsiveness ---
function applySize() {
    w = Math.max(1, container.clientWidth);
    h = Math.max(1, container.clientHeight);
    camera.aspect = w / h;
    if (cameraController) cameraController.setFrame(w, h); // also updates the projection
    camera.updateProjectionMatrix();
    gradePass.setAspect(w / h);
    const dpr = perf.level >= 1 ? 1 : currentDPR();
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h);
    if (composer.setPixelRatio) composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    requestStillFrame();
}
// ResizeObserver covers container size changes; resize also catches DPR changes (zoom / monitor moves).
new ResizeObserver(applySize).observe(container);
window.addEventListener('resize', applySize);

// --- Main Engine Loop ---
let clock = new THREE.Clock();

let inView = true;
let isPaused = false;

function updatePaused() {
    const wasPaused = isPaused;
    isPaused = !inView || document.hidden || reduceMotionMQ.matches;
    if (wasPaused && !isPaused) {
        // Ignore the time gap while paused
        clock.getDelta();
    }
}

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => { inView = entry.isIntersecting; });
    updatePaused();
}, { threshold: 0.1 });
observer.observe(container);

document.addEventListener('visibilitychange', updatePaused);
if (reduceMotionMQ.addEventListener) {
    reduceMotionMQ.addEventListener('change', () => { updatePaused(); requestStillFrame(); });
}
updatePaused();

// Reduced motion / paused: render a single still frame on demand (after loads and resizes).
let stillFrameQueued = false;
function requestStillFrame() {
    if (stillFrameQueued) return;
    stillFrameQueued = true;
    requestAnimationFrame(() => {
        stillFrameQueued = false;
        if (!isPaused) return; // the main loop is already drawing
        if (spitfire) {
            terrainTiler.update(spitfire.position, camera);
            props.update(spitfire.position, 0, true);
            // Let the chase camera settle behind the aircraft (no flight motion)
            if (cameraController) for (let i = 0; i < 60; i++) cameraController.update(1 / 60);
            updateNearPlane();
            updateShadowFrustum();
        }

        sunFlare.update(camera);
        lowClouds.update(camera);
        updateSunScreen();
        composer.render();
        sunFlare.render(renderer);
        heroFrame();
    });
}

// Per-frame temporaries (reused, no allocation in the loop)
const _worldSunDir = new THREE.Vector3();
const _propRotation = new THREE.Quaternion();
const _sunScr = new THREE.Vector3();
// Screen position of the sun for the grade's warm glow (no allocation)
function updateSunScreen() {
    _sunScr.copy(SUN_DIR).multiplyScalar(1000).add(camera.position).project(camera);
    gradePass.setSun(_sunScr.x * 0.5 + 0.5, _sunScr.y * 0.5 + 0.5, _sunScr.z < 1 ? 1 : 0);
}

// --- Adaptive quality: on slow devices drop pixel ratio, then bloom, then cap at 30 fps ---
const perf = { level: 0, frames: 0, time: 0, fpsCap: 0, lastDraw: 0, settle: 5 }  // first window is longer so asset loading hitches are ignored;

// Shadow frustum follows the plane: centred SHADOW_AHEAD units ahead along the camera's ground direction,
// snapped to whole shadow texels in light space (no shimmer). Terrain shadows fade out before the box edge.
const _shC = new THREE.Vector3(), _shV = new THREE.Vector3(), _shR = new THREE.Vector3(), _shU = new THREE.Vector3();
function updateShadowFrustum() {
    if (!spitfire) return;
    camera.getWorldDirection(_shV); _shV.y = 0;
    if (_shV.lengthSq() < 1e-6) _shV.set(0, 0, -1);
    _shV.normalize();
    _shC.copy(spitfire.position).addScaledVector(_shV, SHADOW_AHEAD); _shC.y = 30;
    terrainSplat.uniforms.uShCenter.value.set(_shC.x, _shC.z);
    if (!shadows.on) return;
    // light-space axes (right / up perpendicular to the sun direction) for texel snapping
    _shR.set(0, 1, 0).cross(SUN_DIR).normalize(); _shU.copy(SUN_DIR).cross(_shR);
    const texel = SHADOW_HALF * 2 / 1024;
    const a = Math.round(_shC.dot(_shR) / texel) * texel - _shC.dot(_shR), b = Math.round(_shC.dot(_shU) / texel) * texel - _shC.dot(_shU);
    _shC.addScaledVector(_shR, a).addScaledVector(_shU, b);
    sunLight.target.position.copy(_shC); sunLight.target.updateMatrixWorld();
    sunLight.position.copy(_shC).addScaledVector(SUN_DIR, SHADOW_DIST); sunLight.updateMatrixWorld();
}
function adaptQuality(dt) {
    perf.frames++; perf.time += dt;
    if (perf.time < perf.settle) return;              // average over ~2 s windows
    const fps = perf.frames / perf.time;
    perf.frames = 0; perf.time = 0; perf.settle = 2;
    // shadows go first; they come back only after ~6 s at >= 58 fps with nothing else degraded (max 2 times)
    if (shadows.on && fps < 45) { setShadows(false); shadows.good = 0; return; }
    if (shadows.supported && !shadows.on && perf.level === 0 && shadows.reenables < 2) {
        shadows.good = fps >= 58 ? shadows.good + 1 : 0;
        if (shadows.good >= 3) { shadows.good = 0; shadows.reenables++; setShadows(true); return; }
    }
    if (fps >= 45 || perf.level >= 3) return;
    perf.level++;
    if (perf.level === 1) { renderer.setPixelRatio(1); if (composer.setPixelRatio) composer.setPixelRatio(1); composer.setSize(w, h); }
    else if (perf.level === 2) { bloomPass.enabled = false; }
    else if (perf.level === 3) { perf.fpsCap = 30; lowClouds.setVisible(false); }
}

function animate(now) {

    requestAnimationFrame(animate);

    if (isPaused) {
        return; 
    }

    // 30 fps cap once the device has proven slow
    if (perf.fpsCap && now - perf.lastDraw < 1000 / perf.fpsCap - 2) return;
    perf.lastDraw = now;

    let deltaTime = clock.getDelta();
    if (spitfire) adaptQuality(deltaTime);
    if (deltaTime > 0.1) deltaTime = 0.1;


    // Execute automated aircraft guidance routing pipeline processing
    if (flightController) {
        flightController.update(deltaTime);
    }

    if (spitfire) {
        // Keeps camera focus tracking anchored smoothly to the model coordinate space
        // controls.target.copy(spitfire.position);
        // Feeds the aircraft position coordinates into the grid recalculator
        terrainTiler.update(spitfire.position, camera);
        props.update(spitfire.position, deltaTime);
    }

    if (cameraController) cameraController.update(deltaTime);
    updateNearPlane();
    updateShadowFrustum();
    lowClouds.update(camera, deltaTime);

    // controls.update(); // Resolves smooth lerped damping physics

if (propellerMesh && propMaterial) {
        
        // 1. Get the vector pointing directly TOWARD the sun
        const worldSunDir = _worldSunDir.copy(SUN_DIR);
        
        // 2. Grab the propeller's absolute world rotation
        const propRotation = _propRotation;
        propellerMesh.getWorldQuaternion(propRotation);
        
        // 3. Invert that rotation to convert from World Space to Local Space
        propRotation.inverse(); 
        
        // 4. Rotate the sun's direction vector by the plane's inverted rotation
        const localSunDir = worldSunDir.applyQuaternion(propRotation);
        
        // 5. Feed the true local 2D angle into the shader
        propMaterial.uniforms.uLightDir.value.set(localSunDir.x, localSunDir.y).normalize();
    }

if (vapourTrails.length > 0 && flightController) {
        // Vapour only shows while banking (same rule as before)
        const turnIntensity = Math.abs(flightController.currentRoll) - 0.1;
        const alpha = Math.max(0.0, Math.min(turnIntensity * 0.8, 0.45));
        camera.updateMatrixWorld();
        for (let i = 0; i < vapourTrails.length; i++) {
            vapourTrails[i].opacity = alpha;
            vapourTrails[i].update(camera);
        }
    }

    
    sunFlare.update(camera);
    updateSunScreen();
    composer.render();
    sunFlare.render(renderer);
    heroFrame();
}

requestAnimationFrame(animate);

// Opt-in test hook (?fxdebug): exposes scene state for automated screenshots. Nothing is exposed otherwise.
if (location.search.indexOf('fxdebug') >= 0) window.__fx = { THREE, scene, camera, renderer, props, treeLod: { trunk: lodTrunkUniform, tint: lodTintUniform, bend: lodBendUniform }, perf, shadows, setShadows, terrainSplat, PROPS, TERRAIN, LIGHTING, DEPTH, composer, vapourTrails, fill, propFillUniform, heroLoad, get spitfire() { return spitfire; }, get flight() { return flightController; }, get cam() { return cameraController; } };
