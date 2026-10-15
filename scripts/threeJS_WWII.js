import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.117.1/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RGBELoader } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/loaders/RGBELoader.js';
import { TerrainTiler } from './TerrainTiler.js';
import { DynamicCameraController } from './CameraController.js';
import { WingtipTrail } from './WingtipTrail.js';
import { FlightController } from './flightcontroller.js';
import { SunFlare } from './SunFlare.js';
import { LowClouds } from './LowClouds.js';
import { GodRays } from './GodRays.js';
import { Dogfight } from './Dogfight.js';
import { DRACOLoader } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/loaders/DRACOLoader.js';

// --- Scene Setup ---
const container = document.getElementById('show-screen');
let w = container.clientWidth;
let h = container.clientHeight;


const scene = new THREE.Scene();

// ADD DISTANCE FOG HERE:
// Using a cool sky-blue/gray tint that matches your ambientAO fill light
scene.fog = new THREE.FogExp2(0x959999, 0.0008);

const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 30000);
camera.position.set(-20, 100, -100); // Initial offset position relative to the plane height


const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.46;
// Lower DPR cap on touch devices to keep phones cool.
const IS_COARSE_POINTER = window.matchMedia('(pointer: coarse)').matches;
const MAX_DPR = IS_COARSE_POINTER ? 1.25 : 2;
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
const sunLight = new THREE.DirectionalLight(0xfffaed, 2.0); // Warm sunset sun color
sunLight.position.set(100, 30, 100);
scene.add(sunLight);

// --- Sun Flare ---
const sunFlare = new SunFlare(scene, sunLight, { distance: 5000, size: 500 });
const lowClouds = new LowClouds(scene, { count: 220, minY: 90, maxY: 220, radius: 900, sunDir: sunLight.position });
let dogfight = null;

// Ambient light to act as uniform Ambient Occlusion fill across shadowed areas
const ambientAO = new THREE.AmbientLight(0x93dcf5, 2.4); // Cool sky tint for fill shadows
scene.add(ambientAO);

const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();

const hdriLoader = new RGBELoader();
hdriLoader.load('assets/texture/hdri/modified_SKY_lite_ultra.hdr', (texture) => {
    const envMap = pmremGenerator.fromEquirectangular(texture).texture;
    scene.environment = envMap;      // Reflection probe for PBR materials
    scene.background = envMap;       // Skybox background
    texture.dispose();
    pmremGenerator.dispose();
    requestStillFrame();
});

// --- Post Processing Stack (Bloom) ---
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const godRays = new GodRays(sunLight, { intensity: 0.35, resolutionScale: 0.25, samples: 28 });
composer.addPass(godRays.pass);

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(w, h),
    0.23,  // Bloom Strength
    2.5,  // Radius
    0.1  // Threshold 
);
composer.addPass(bloomPass);


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
    tileSize: 1042, // 5km matching your mesh size
    gridSize: 4     // 3x3 tile grid context matrix
});

let landModel = null;
let treesModel = null;


function checkAssetsReady() {
    if (landModel && treesModel) {
        terrainTiler.init(landModel, treesModel);
    }
}




// --- Load Terrain & Trees ---
gltfLoader.load('assets/models/land_02_draco.glb', (gltf) => {
    const terrainScene = gltf.scene;

        let landMaterial = new THREE.MeshBasicMaterial({
                color: 0x777777,
                map: LoadTexture('assets/texture/land_combined_01.jpg', false)   
            });

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
    terrainTiler.init(landLODs, rawTreesMesh);
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
    vapourTrails.push(new WingtipTrail(scene, trailTarget, { width, maxPoints: 40, segmentLength: 1.5 }));
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
                CreateTrail(child, 0.09);
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

    cameraController = new DynamicCameraController(camera, spitfire, flightController, {
        baseOffset: new THREE.Vector3(4, 3.55, -10), 
        posLerp: 20.0 
    });

    dogfight = new Dogfight(scene, spitfire, spitfire, { count: 3, fireCone: 8, range: 380, playerController: flightController });

    //CreateTrail(spitfire);
    requestStillFrame();
});

// Setup Trail




// --- Responsiveness ---
function applySize() {
    w = Math.max(1, container.clientWidth);
    h = Math.max(1, container.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
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
        godRays.update(camera);
        composer.render();
        sunFlare.render(renderer);
    });
}

// Per-frame temporaries (reused, no allocation in the loop)
const _worldSunDir = new THREE.Vector3();
const _propRotation = new THREE.Quaternion();

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
    else if (perf.level === 2) { bloomPass.enabled = false; godRays.setEnabled(false); }
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
    if (dogfight) dogfight.update(deltaTime, camera);
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
        const alpha = Math.max(0.0, Math.min(turnIntensity, 0.6));
        camera.updateMatrixWorld();
        for (let i = 0; i < vapourTrails.length; i++) {
            vapourTrails[i].opacity = alpha;
            vapourTrails[i].update(camera);
        }
    }

    
    sunFlare.update(camera);
    godRays.update(camera);
    composer.render();
    sunFlare.render(renderer);
}

requestAnimationFrame(animate);
