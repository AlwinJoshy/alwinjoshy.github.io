import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.117.1/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RGBELoader } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/loaders/RGBELoader.js';
import { TerrainTiler } from './TerrainTiler.js';
import { DynamicCameraController } from './CameraController.js';
import { TrailRenderer } from './TrailRenderer.js';
import { FlightController } from './flightcontroller.js';

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
renderer.toneMappingExposure = 0.56;
renderer.setSize(w, h);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

// --- Orbit Controls ---
// const controls = new OrbitControls(camera, renderer.domElement);
// controls.enableDamping = true;
// controls.dampingFactor = 0.3;
// controls.maxDistance = 10; // Pin the camera's zoom distance close to the aircraft
// controls.minDistance = 3;

// --- Lighting & Environment Probe ---
const sunLight = new THREE.DirectionalLight(0xfffaed, 2.0); // Warm sunset sun color
sunLight.position.set(100, 40, -100); 
scene.add(sunLight);

// Ambient light to act as uniform Ambient Occlusion fill across shadowed areas
const ambientAO = new THREE.AmbientLight(0x93dcf5, 2.4); // Cool sky tint for fill shadows
scene.add(ambientAO);

const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();

const hdriLoader = new RGBELoader();
hdriLoader.load('assets/texture/hdri/modified_SKY.hdr', (texture) => {
    const envMap = pmremGenerator.fromEquirectangular(texture).texture;
    scene.environment = envMap;      // Reflection probe for PBR materials
    scene.background = envMap;       // Skybox background
    texture.dispose();
    pmremGenerator.dispose();
});

// --- Post Processing Stack (Bloom) ---
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(w, h),
    0.2,  // Bloom Strength
    2.5,  // Radius
    0.1  // Threshold 
);
composer.addPass(bloomPass);


function LoadTexture(path){
    const textureLoader = new THREE.TextureLoader();
    const texture = textureLoader.load(path);
    texture.flipY = false;
    return texture;
}

// --- GLTF Asset Asset Loading ---
const gltfLoader = new GLTFLoader();
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
gltfLoader.load('assets/models/land.glb', (gltf) => {
    const terrainScene = gltf.scene;

        let landMaterial = new THREE.MeshBasicMaterial({
                color: 0xaaaaaa,    
                map: LoadTexture('assets/texture/land_combined_03.png')   
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
            console.log("Terrain Child name : " + meshName);


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

function CreateTrail(trailTarget = null, width = 0.2) {

    // specify points to create planar trail-head geometry
    let trailHeadGeometry = [];
    trailHeadGeometry.push( 
    new THREE.Vector3( -width, 0.0, 0.0 ), 
    new THREE.Vector3( 0.0, 0.0, 0.0 ), 
    new THREE.Vector3( width, 0.0, 0.0 ) 
    );

    // create the trail renderer object
    let trail = new TrailRenderer( scene, false );

    vapourTrails.push(trail);

    // set how often a new trail node will be added and existing nodes will be updated
    trail.setAdvanceFrequency(15);

// create material for the trail renderer
    const trailMaterial = TrailRenderer.createBaseMaterial();	
    
    // FIX 1: Set colors to White, but initialize alpha to 0.0 (Invisible)
    trailMaterial.uniforms.headColor.value.set(1.0, 1.0, 1.0, 0.5);
    trailMaterial.uniforms.tailColor.value.set(1.0, 1.0, 1.0, 0.5);

    // Store the material inside the trail object so the animate loop can find it
    trail.material = trailMaterial;

    // specify length of trail
    const trailLength = 30;

    // initialize the trail
    trail.initialize( trailMaterial, trailLength, false, 0, trailHeadGeometry, trailTarget );

    // activate the trail
    trail.activate();
    trail.mesh.frustumCulled = false; // <--- ADD THIS

    
}


let flightController = null;
let cameraController = null;
let propMaterial = null;
let propellerMesh = null;

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
        else{
            //console.log("Spitfire Child name : " + child.name);

            if(child.name == 'trail_l' || child.name == 'trail_r'){
                CreateTrail(child, 0.2);
            }
        }
    });

    // ... The rest of your setup ...
    spitfire.position.set(0, aircraftHeight, 0);
    let scale = 1;
    spitfire.scale.set(scale, scale, scale);
    scene.add(spitfire);

    flightController = new FlightController(spitfire, {
        minY: 1000, 
        maxY: 500,
        baseSpeed: 50.0 
    });

    cameraController = new DynamicCameraController(camera, spitfire, flightController, {
        baseOffset: new THREE.Vector3(2, 2.55, -5), 
        posLerp: 20.0 
    });

    //CreateTrail(spitfire);
});

// Setup Trail




// --- Responsiveness ---
window.addEventListener('resize', () => {
     w = container.clientWidth;
     h = container.clientHeight;
     camera.aspect = w / h;
     camera.updateProjectionMatrix();
     renderer.setSize(w, h);
     composer.setSize(w, h);
});

// --- Main Engine Loop ---
let clock = new THREE.Clock();


let isPaused = false;

// Create the observer
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        isPaused = !entry.isIntersecting;
        
        if (!isPaused) {
            // FIX: This forces the clock to ignore the time gap
            clock.stop();
            clock.start(); 
            
            // Re-sync the renderer to prevent black-screen
            renderer.setSize(container.clientWidth, container.clientHeight);
            composer.setSize(container.clientWidth, container.clientHeight);
        }
    });
}, { threshold: 0.1 });


function animate() {

    
    requestAnimationFrame(animate);

    if (isPaused) {
        return; 
    }

    let deltaTime = clock.getDelta();
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

    // controls.update(); // Resolves smooth lerped damping physics

if (propellerMesh && propMaterial && sunLight) {
        
        // 1. Get the vector pointing directly TOWARD the sun
        const worldSunDir = sunLight.position.clone().normalize();
        
        // 2. Grab the propeller's absolute world rotation
        const propRotation = new THREE.Quaternion();
        propellerMesh.getWorldQuaternion(propRotation);
        
        // 3. Invert that rotation to convert from World Space to Local Space
        propRotation.inverse(); 
        
        // 4. Rotate the sun's direction vector by the plane's inverted rotation
        const localSunDir = worldSunDir.applyQuaternion(propRotation);
        
        // 5. Feed the true local 2D angle into the shader
        propMaterial.uniforms.uLightDir.value.set(localSunDir.x, localSunDir.y).normalize();
    }

if (vapourTrails.length > 0) {
        vapourTrails.forEach(trail => {
            // Update material alpha for turn-intensity
            let turnIntensity = (Math.abs(flightController.currentRoll) * 1.0) - 0.1;
            let alpha = Math.max(0.0, Math.min(turnIntensity, 0.6));
            trail.material.uniforms.headColor.value.set(1.0, 1.0, 1.0, alpha);
            trail.material.uniforms.tailColor.value.set(1.0, 1.0, 1.0, alpha);
            
            // Advance the trail geometry
            trail.advance(); 
        });
    }

    composer.render();
}

animate();
// Stray bracket removed successfully