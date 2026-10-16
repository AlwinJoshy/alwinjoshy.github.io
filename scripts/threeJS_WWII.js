import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.117.1/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RGBELoader } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/loaders/RGBELoader.js';
import { TerrainTiler } from './TerrainTiler.js';
import { CalmCamera } from './CalmCamera.js';
import { createGradePass, sampleHorizon, addCloudShadows, toneMapACES, addSkyFog, createSkyMesh, addTerrainDetail } from './HeroFX.js';
import { WingtipTrail } from './WingtipTrail.js';
import { FlightController } from './flightcontroller.js';
import { SunFlare } from './SunFlare.js';
import { LowClouds } from './LowClouds.js';
import { DRACOLoader } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/loaders/DRACOLoader.js';

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

const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, FOG_FAR * 1.45); // well past full haze; sky background is never clipped
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
const sunLight = new THREE.DirectionalLight(0xffc98f, 2.2); // warm golden sunset sun (lights the Spitfire)
sunLight.position.set(100, 30, 100);
scene.add(sunLight);

// --- Sun Flare ---
const sunFlare = new SunFlare(scene, sunLight, { distance: 5000, size: 500 });
// Fewer, bigger, denser puffs, wrapped around a point AHEAD of the camera so nearly all of them are in view.
const lowClouds = new LowClouds(scene, { count: IS_LOW_TIER ? 35 : 60, minY: 110, maxY: 230, radius: 700, aheadFactor: 0.6,
    minSize: 180, maxSize: 340, opacity: 0.38, sunDir: sunLight.position, fogNear: FOG_NEAR, fogFar: FOG_FAR });

// Ambient light to act as uniform Ambient Occlusion fill across shadowed areas
const ambientAO = new THREE.AmbientLight(0x93dcf5, 2.4); // Cool sky tint for fill shadows
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
    requestStillFrame();
});

// --- Post Processing Stack (Bloom) ---
// Composer targets: HalfFloat where renderable (desktop), so the linear-light intermediate image doesn't band
// in the darks; 8-bit on the low tier. The final grade pass adds dither either way.
const gl2 = renderer.capabilities.isWebGL2;
const halfOK = !IS_LOW_TIER && (gl2 ? !!renderer.extensions.get('EXT_color_buffer_float') : !!renderer.extensions.get('EXT_color_buffer_half_float'));
const composer = halfOK
    ? new EffectComposer(renderer, new THREE.WebGLRenderTarget(w * currentDPR(), h * currentDPR(), {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.HalfFloatType, stencilBuffer: false }))
    : new EffectComposer(renderer);
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

let landModel = null;
let treesModel = null;


function checkAssetsReady() {
    if (landModel && treesModel) {
        terrainTiler.init(landModel, treesModel);
    }
}




// Terrain is only shown once BOTH the glb and its texture are ready (avoids an untextured-grey frame then a pop).
let landMapReady = false, pendingTerrain = null;
const landMap = textureLoader.load('assets/texture/land_combined_01_2k.jpg', () => {
    landMapReady = true;
    if (pendingTerrain) { terrainTiler.init(pendingTerrain[0], pendingTerrain[1]); pendingTerrain = null; }
    requestStillFrame();
});
landMap.flipY = false;

// --- Load Terrain & Trees ---
gltfLoader.load('assets/models/land_02_draco.glb', (gltf) => {
    const terrainScene = gltf.scene;

        let landMaterial = new THREE.MeshBasicMaterial({
                color: 0x888888,   // brighter land (MeshBasic: this is the exposure of the terrain)
                map: landMap   
            });

        // scrolling cloud shadows, drifting with the LowClouds wind
        addCloudShadows(landMaterial, { windOffset: lowClouds.uniforms.uWindOff.value, scale: 1 / 900, strength: 0.25 });
        addSkyFog(landMaterial, skyTexUniform, skyReadyUniform);
        // near-camera snow / rock / grass detail (one channel-packed 256px texture, 1 lookup); skipped on the low tier
        if (!IS_LOW_TIER) addTerrainDetail(landMaterial, LoadTexture('assets/texture/detail/terrain_detail_pack.jpg', false), { scale: 1 / 30, near: 700, far: 1400, strength: 1.0 }); // terrain is ~500-1000 units from the camera

            let treeMaterial = new THREE.MeshBasicMaterial({
                color: 0x333333,    
                map: LoadTexture('assets/texture/tree_02.png'),
                
                // 1. Render both sides of the flat plane geometry
                side: THREE.DoubleSide,
                
                // 2. Enable Alpha Clipping (drops pixels below 0.5 opacity)
                alphaTest: 0.5,
                
                // 3. Ensure it writes into the depth buffer cleanly 
                // to prevent background objects leaking through
                depthWrite: true,
                depthTest: true
            });
            addSkyFog(treeMaterial, skyTexUniform, skyReadyUniform);
            

    // Array to temporarily collect our 5 levels in correct order
    const landLODs = new Array(5);
    let rawTreesMesh = null;

    terrainScene.traverse((child) => {
        if (child.isMesh) {
            const meshName = child.name;


              if (meshName.startsWith('Landscape_LOD')) {
                    const oldMat = child.material;
                    child.material = landMaterial;
             }
             else if (meshName.includes('Trees')) {
                    const oldMat = child.material;
                    child.material = treeMaterial;
             }

            // Sort out our land LOD variations dynamically by name matching
            if (meshName === 'Landscape_LOD0') landLODs[0] = child;
            else if (meshName === 'Landscape_LOD1') landLODs[1] = child;
            else if (meshName === 'Landscape_LOD2') landLODs[2] = child;
            else if (meshName === 'Landscape_LOD3') landLODs[3] = child;
            else if (meshName === 'Landscape_LOD4') landLODs[4] = child;
            
            // Capture the shared scatter element
            else if (meshName.includes('Trees')) {
                rawTreesMesh = child;
            }
        }
    });

    // Check to ensure your pipeline didn't miss a variation level
    if (landLODs.includes(undefined) || !rawTreesMesh) {
        console.error("LOD Setup Error: Missing one of the 5 Land levels or Trees mesh in GLTF structural layout!");
        return;
    }

    // Pass the ordered LOD array to the rebuilt terrain manager system
    if (landMapReady) terrainTiler.init(landLODs, rawTreesMesh); else pendingTerrain = [landLODs, rawTreesMesh];
    requestStillFrame();
});



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

flightController = new FlightController(spitfire, {
    minY: 50,          // keep above the ~70 m peaks
    maxY: 260,
    baseSpeed: 50.0,
    maxClimb: 0.7,    // steeper dives and climbs (about 26°)
    altSpeed: 10.5,     // how often it dips and climbs
    pitchResponse: 8.8, // how quickly it noses up or down
    rollResponse: 6.0,  // how quickly it banks left or right
    turnFrequency: 1.0,  // how often it changes direction
});

    cameraController = new CalmCamera(camera, spitfire, flightController);
    cameraController.setFrame(w, h);


    //CreateTrail(spitfire);
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
            // Let the chase camera settle behind the aircraft (no flight motion)
            if (cameraController) for (let i = 0; i < 60; i++) cameraController.update(1 / 60);
        }

        sunFlare.update(camera);
        lowClouds.update(camera);
        updateSunScreen();
        composer.render();
        sunFlare.render(renderer);
    });
}

// Per-frame temporaries (reused, no allocation in the loop)
const _worldSunDir = new THREE.Vector3();
const _propRotation = new THREE.Quaternion();
const _sunScr = new THREE.Vector3();
// Screen position of the sun for the grade's warm glow (no allocation)
function updateSunScreen() {
    _sunScr.copy(sunLight.position).normalize().multiplyScalar(1000).add(camera.position).project(camera);
    gradePass.setSun(_sunScr.x * 0.5 + 0.5, _sunScr.y * 0.5 + 0.5, _sunScr.z < 1 ? 1 : 0);
}

// --- Adaptive quality: on slow devices drop pixel ratio, then bloom, then cap at 30 fps ---
const perf = { level: 0, frames: 0, time: 0, fpsCap: 0, lastDraw: 0, settle: 5 }  // first window is longer so asset loading hitches are ignored;
function adaptQuality(dt) {
    perf.frames++; perf.time += dt;
    if (perf.time < perf.settle) return;              // average over ~2 s windows
    const fps = perf.frames / perf.time;
    perf.frames = 0; perf.time = 0; perf.settle = 2;
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
    }

    if (cameraController) cameraController.update(deltaTime);
    lowClouds.update(camera, deltaTime);

    // controls.update(); // Resolves smooth lerped damping physics

if (propellerMesh && propMaterial && sunLight) {
        
        // 1. Get the vector pointing directly TOWARD the sun
        const worldSunDir = _worldSunDir.copy(sunLight.position).normalize();
        
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
}

requestAnimationFrame(animate);
