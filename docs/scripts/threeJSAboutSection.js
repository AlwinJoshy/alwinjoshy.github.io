import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.117.1/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/postprocessing/RenderPass.js';

import { UnrealBloomPass } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/postprocessing/UnrealBloomPass.js';
//import { UnrealBloomPass } from './UnrealBloomPass.js';
import { BokehPass } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/postprocessing/BokehPass.js';

import { RGBELoader } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/loaders/RGBELoader.js';
import { LightProbeGenerator } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/lights/LightProbeGenerator.js';
//import { LightProbeHelper } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/helpers/LightProbeHelper.js';


//#region Objects

class Bullet {
    // Constructor method, called when an object is instantiated
    constructor(model, scene, position, rotation, duration) {
        this.model = model;
        this.rotation = rotation;
        this.duration = duration;

        let fVector = new THREE.Vector3(0,0,1);
        fVector.applyQuaternion(rotation);

        this.direction = fVector;
        //DrawLine(position, fVector)

        model.position.copy(position);
        this.instance = model.clone();
        this.instance.lookAt(new THREE.Vector3().addVectors(position, fVector));
        scene.add(this.instance);
         // Optionally, you can use a timer to hide or remove the bullet after a certain duration
         setTimeout(() => {
            scene.remove(this.instance);
            Remove(Update());
            // // Optionally, you can enable the object again after another duration
            // setTimeout(() => {
            //     scene.add(this.instance);
            // }, this.duration);
        }, this.duration * 1000);
        
    }

    Update() {

        const localDirection = this.direction.clone().applyQuaternion(this.rotation.clone().inverse());
        this.instance.translateOnAxis(localDirection, 1.3);
    }

}

//#endregion


// Get the container div
const container = document.getElementById('show-screen');

let w = container.clientWidth;
let h = container.clientHeight;

const scene = new THREE.Scene();

//#region Camera
const camera = new THREE.PerspectiveCamera( 60, w / h, 0.1, 1000);
camera.position.set(5, 3, 8);
camera.lookAt(0,0,0);
//#endregion

//#region CubeCamer
const cubeRenderTarget = new THREE.WebGLCubeRenderTarget( 256 );
let cubeCamera = new THREE.CubeCamera( 1, 1000, cubeRenderTarget );
//#endregion


//#region renderer
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.setSize( w, h );
container.appendChild(renderer.domElement);
//#endregion


const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
renderPass.clear = true;
renderPass.alpha = true;
composer.addPass(renderPass);

//#region DOF
// Add BokehPass for depth of field
const bokehPass = new BokehPass(scene, camera, {
    focus: 100.1,
    aperture: .00005,
    maxblur: 0.02,
    width: w / 2,
    height: h / 2
  });
//composer.addPass(bokehPass);
//#endregion


//#region Add a RenderPass to render the scene


let bloomPass = new UnrealBloomPass(
    new THREE.Vector2(w * 2, h * 2),
    5,
    1.3,
    .3
);

composer.addPass(bloomPass);
//#endregion


//#region resize
let dynamicPlanetPostion = new THREE.Vector3(-200, -2000, -400);
SetScreenSize();

window.addEventListener('resize', () => {
    SetScreenSize();
  });

  function SetScreenSize() {
        // Update size
        w = container.clientWidth;
        h = container.clientHeight;
        
        // Update camera aspect ratio
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      
        // Update renderer size
        renderer.setSize(w, h);
      
        // Update any post-processing effects or passes if needed
        composer.setSize(w, h);
        bokehPass.setSize(w, h);
        
        if (w < 430) {
            console.log(w);
            //camera.position.set(10, 15, 3);
            //camera.position.set(10, 15, 3);
            //dynamicPlanetPostion = new THREE.Vector3(-10, -100, -100);
    
        } else {
            
        }
  }

//#endregion

//#region Mouse move Detection

let mouseX = 0, mouseY = 0;

window.addEventListener('mousemove', (event) => {
    console.log("mouse move");
    // Calculate normalized mouse coordinates
    mouseX = (event.clientX / window.innerWidth) * 2 - 1;
    mouseY = -(event.clientY / window.innerHeight) * 2 + 1;

    
});

//#endregion


//#region Directional Light
const directionalLight = new THREE.DirectionalLight(0xffffff, .3);
directionalLight.position.set(1, 1, -1);
scene.add(directionalLight);
//#endregion

//#region probe
let lightProbe = new THREE.LightProbe();
//#endregion

//#region Load the GLTF model
let mixer;
const loader = new GLTFLoader();
const hdriLoader = new RGBELoader();
const pmremGenerator = new THREE.PMREMGenerator( renderer );
pmremGenerator.compileEquirectangularShader();
let hdrPMREMRenderTarget = null;
let hdrEquirectangularMap = null;


let testMaterial = new THREE.MeshStandardMaterial( {
    color: 0xffffff,
    metalness: 1,
    roughness: 0.5,
    emissive: 0x00ff00,
    emissiveIntensity: 10,
} );


const generalMaterialProperty = {
    color: 0xffffff,
    map: null,
    roughnessMap: null,
    aoMap: null,
    aoMapIntensity: .5,
    envMapIntensity: .2,
    metalness: .3,
    roughness: .3,
    exposure: 0.5,
    wireframe: false,
};

//#region Load Mesh
function LoadGLBMoedl(modelPath, onModelLoaded) {
    loader.load(modelPath, (glb) => {
        onModelLoaded(glb)
        return glb.scene;
    });
}

async function aLoadGLBModel(modelPath) {
    return new Promise((resolve, reject) => {
        loader.load(modelPath, (glb) => {
            if (glb.scene) {
                resolve(glb.scene);
            } else {
                reject(new Error('Failed to load GLB model.'));
            }
        }, undefined, reject);
    });
}

//#endregion

function AddStandardTexture(file, albedoPath, roughnessPath, aoMapPath, materialParams){

       // Load a texture
       let albedo = LoadTexture(albedoPath);
       let roughness = LoadTexture(roughnessPath);
       let aoMap = LoadTexture(aoMapPath);
   
       let property = materialParams;
       property.map = albedo;
       property.roughnessMap = roughness;
       property.aoMap = aoMap;
   
       let material = new THREE.MeshStandardMaterial({
           color: 0xffffff,
           map: albedo,
           roughnessMap: roughness,
           aoMap: aoMap,
           aoMapIntensity: .7,
           envMapIntensity: .1,
           metalness: .6,
           roughness: .3,
           exposure: 0.5,
           wireframe: false,
       });
       
               // Apply the material to the mesh
               file.scene.traverse((node) => {
                   if (node.isMesh) {
                       node.material = material;
                   }
               });
   
       // color: 0xffffff,
       // map: albedo,
       // roughnessMap: roughness,
       // aoMap: aoMap,
       // aoMapIntensity: .6,
       // envMapIntensity: 1,
       // metalness: .1,
       // roughness: 1,
       // exposure: 0.5,
       // debug: false
   
        material.envMap = HDRITex, // Use the texture property
        material.needsUpdate = true;
   
       // Play the animations
       mixer = new THREE.AnimationMixer(glbModel);
       file.animations.forEach((clip) => {
           mixer.clipAction(clip).play();
       });
       
       // Add the model to the scene
       scene.add(file.scene);

       return material;
   
   //    postProcess(file.scene);
}

function AddTextureToMaterial(material, path, name) {
    material[name] = LoadTexture(path);
}

//#region LoadHDRI
let HDRITex;
    LoadWorldHDRI((texture)=>{
        HDRITex = texture;
    });
//#endregion

//#region load models

let blasterGreen = null;
let planet = null;
let glbModel = null;
let tie = null;
let firePoints = null;
let shySphere = null;

LoadGLBMoedl(
    'assets/models/laser_blast.glb', (file) => {

        blasterGreen = file;

        file.scene.position.set(0, 0, 0);
        file.scene.scale.set(.05, .05, .1);
        file.scene.rotation.set(0, 0, 0);

        const material = new THREE.MeshStandardMaterial({
            color: 0x22ff22,
            metalness: 0,
            roughness: 1,
            envMapIntensity: 0,
            emissive: 0x00ff00,
            emissiveIntensity: 10,
        });
        
        // Apply the material to the mesh
        file.scene.traverse((node) => {
            if (node.isMesh) {
                node.material = material;
            }
        });
    }
);

function LoadPlanet(action){
    planet = LoadGLBMoedl(
        'assets/models/planet.glb', (file) => {
            planet = file.scene;
            //file.scene.position.copy(dynamicPlanetPostion);
            const size = 12;
            planet.scale.set(size, size, size);
            planet.rotation.set(0, 3.14159, 0);
            planet.position.set(50, -350, -200);
  
            planet.traverse((node) => {
                console.log(node.name);
                if (node.isMesh) {
                    if(node.name == "Phoenix_LOD0"){
                        node.material.color = {r:.5, g:.1, b:.1};
                    }
                    else if(node.name == "Icosphere"){
                        //node.material = fresnelMaterial;
                    }
                }
            });

            scene.add(planet);
            if(action != null || action != undefined){
     action();
}
        }
    );
}


function SkySphere(action) {
    shySphere = LoadGLBMoedl(
        'assets/models/skySphere.glb', (file) => {
            shySphere = file.scene;
            shySphere.position.set(0, 0, 0);
            shySphere.scale.set(100, 100, 100);
            shySphere.rotation.set(0, -3.1, 0);
    
            const skymaterial = new THREE.MeshBasicMaterial(
                {
                    color: {r:0, g:0, b:1}, 
                    emissive: 0x000000, 
                    emissiveIntensity: 0,
                    opacity: 1,
                    exposure: 2,
                    transparent: true, 
                    depthWrite: false,
                    blending: THREE.AdditiveBlending,
                }
            );


            shySphere.traverse((node) => {
                console.log(node.name);
                if (node.isMesh) {
                    //node.material = skymaterial;
                    node.material.color = {r:0, g:.5, b:.6};
                    node.material.emissive = {r:.3, g:.2, b:1};
                }
            });

            scene.add(shySphere);

            if(action != null || action != undefined){
     action();
}
        }
    );
}

function LoadXWing(action){
    glbModel = LoadGLBMoedl(
        'assets/models/x-wing.glb', (file) => {
            glbModel = file.scene;
            file.scene.position.set(0, 0, -5);
            file.scene.scale.set(.5, .5, .5);
            file.scene.rotation.set(0, 3.14159, 0);
    
            const baseMaterial = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                aoMapIntensity: .7,
                envMapIntensity: .1,
                emissiveIntensity: 100,
                metalness: .6,
                roughness: .3,
                exposure: 1,
                wireframe: false,
            });

            AddTextureToMaterial(baseMaterial, 'assets/texture/xwing_Albedo.png', "map");
            AddTextureToMaterial(baseMaterial, 'assets/texture/xwing_Roughness.png', "roughnessMap");
            AddTextureToMaterial(baseMaterial, 'assets/texture/xwing_AO.png', "aoMap");

            const tailGlow = new THREE.MeshBasicMaterial(
                {
                    color: 0xffffff, 
                    emissive: 0xffffff, 
                    emissiveIntensity: 100,
                    opacity: 1,
                    exposure: 2,
                    transparent: true, 
                    depthWrite: false,
                    blending: THREE.AdditiveBlending,
                }
            );

            AddTextureToMaterial(tailGlow, 'assets/texture/transparent_VFX.png', "map");
            AddTextureToMaterial(tailGlow, 'assets/texture/transparent_VFX.png', "emissiveMap");


            file.scene.traverse((node) => {
                console.log(node.name);
                if (node.isMesh) {
                    if(node.name == "Cube.076_Cube.002_0"){
                        node.material = baseMaterial;
                    }
                    else if(node.name == "Cube.076_Cube.002_1"){
                        node.material = tailGlow;
                    }
                }
            });

            scene.add(file.scene);

            if(action != null || action != undefined){
     action();
}
        }
    );
    
}

function LoadTie(action){
    tie = LoadGLBMoedl(
        'assets/models/tie_fighter.glb', (file) => {
            tie = file.scene;
            file.scene.position.set(0, 1, -35);
            file.scene.scale.set(.5, .5, .5);
            file.scene.rotation.set(0, 0, 0);
    
            const aircraftModel = file.scene.getObjectByName('tie_fighter');
            firePoints = aircraftModel.getObjectByName('fire_point');
    
            const worldPosition = new THREE.Vector3();
            firePoints.getWorldPosition(worldPosition);
    
            let greenPointLight = new THREE.PointLight(0xff0000, .1, 10);
            greenPointLight.position.copy(worldPosition);
            file.scene.add(greenPointLight);
    
            const baseMaterial = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                aoMapIntensity: .7,
                envMapIntensity: .1,
                emissiveIntensity: 100,
                metalness: .1,
                roughness: .3,
                exposure: 1,
                wireframe: false,
            });

            AddTextureToMaterial(baseMaterial, 'assets/texture/tie_Albedo.png', "map");
            AddTextureToMaterial(baseMaterial, 'assets/texture/tie_Roughness.png', "roughnessMap");
            AddTextureToMaterial(baseMaterial, 'assets/texture/tie_AO.png', "aoMap");

            file.scene.traverse((node) => {
                console.log(node.name);
                if (node.isMesh) {
                    node.material = baseMaterial;
                }
            });

            scene.add(file.scene);
            if(action != null || action != undefined){
     action();
}
        }
    );
}

let starDestroyer = null;
let starDestroyer2 = null;
let starDestroyer3 = null;

function LoadStarDestroyer(action) {
    starDestroyer = LoadGLBMoedl(
        'assets/models/starDestroyer.glb', (file) => {
            starDestroyer = file.scene;
            starDestroyer2 = starDestroyer.clone();
            starDestroyer3 = starDestroyer.clone();

            starDestroyer.position.set(-50, 0, -60);
            starDestroyer2.position.set(10, -20, -40);
            starDestroyer3.position.set(-30, -30, -20);

            const size = 5;
            starDestroyer.scale.set(size, size, size);
            starDestroyer2.scale.set(size, size, size);
            starDestroyer3.scale.set(size, size, size);

            starDestroyer.rotation.set(0, 1, 0);
            starDestroyer2.rotation.set(0, 2.5, 0);
            starDestroyer3.rotation.set(0, 1, 0);
    
            scene.add(starDestroyer);
            scene.add(starDestroyer2);
            scene.add(starDestroyer3);
            
            if(action != null || action != undefined){
                action();
            }
        }
    );
}

let deathStar = null;


async function LoadDeathStar(action) {
    try {
        const model = await aLoadGLBModel('assets/models/deathStar.glb');
       
        deathStar = model;

            deathStar.position.set(-100, -50, -50);

            const size = 1;
            deathStar.scale.set(size, size, size);

            deathStar.rotation.set(0, -.9, 0);

            
            deathStar.traverse((node) => {
                console.log(node.name);
                if (node.isMesh) {
                    let material = node.material;
                    material.envMap = HDRITex;
                    material.aoMapIntensity = 0;
                    material.envMapIntensity = .3;
                    material.wireframe = false;
                    material.metalness = .1,
                    material.roughness = 1,
                    material.exposure = 1,
                    material.needsUpdate = true;
                }
            });

            scene.add(deathStar);

            if(action != null || action != undefined){
                action();
            }
        
    } catch (error) {
        console.error(error);
    }
}

async function onModelLoaded(glbModel) {
    try {
        const scene = await loadGLBModel('path/to/model.glb');
        // Do something with the loaded scene
    } catch (error) {
        console.error(error);
    }
}

// load all the modals in order
SkySphere(
    LoadPlanet(
        LoadDeathStar(
            LoadStarDestroyer(
                LoadTie(
                    LoadXWing(
                        () => {
                            console.log("models loaded");
                        }
                    )
                )
            )
        )
    ));



//#endregion

//#region load tie fighter

//#endregion
function LoadWorldHDRI(onLoad) {

    if(hdrEquirectangularMap == null){

    let hdrEquirectangularMap = hdriLoader.load( 'assets/texture/hdri/lighting_3.hdr', function (hdrImage) {
    
            hdrEquirectangularMap = hdrImage;
    
            // Generate PMREM texture for environment mapping
            hdrPMREMRenderTarget = pmremGenerator.fromEquirectangular(hdrEquirectangularMap);
            hdrPMREMRenderTarget.texture.encoding = THREE.sRGBEncoding;
        
            hdrEquirectangularMap.mapping = THREE.EquirectangularReflectionMapping;
            hdrEquirectangularMap.minFilter = THREE.LinearFilter;
            hdrEquirectangularMap.magFilter = THREE.LinearFilter;
            hdrEquirectangularMap.needsUpdate = true;
        
            onLoad(hdrImage);
    
            // prob
            //lightProbe.copy( LightProbeGenerator.fromCubeTexture( hdrImage ) );
    
        
    
            scene.environment = lightProbe;

            scene.environment = hdrPMREMRenderTarget.texture;
            scene.background = hdrPMREMRenderTarget.texture;
    
    
            // light prob
    
            cubeCamera.update( renderer, scene );
            lightProbe.copy( LightProbeGenerator.fromCubeRenderTarget( renderer, cubeRenderTarget ) );
            scene.add( lightProbe );
            //scene.add( new LightProbeHelper( lightProbe, 1 ) );
    
            scene.background = null;
            scene.environment = null;
    

        
    
        }, function ( progress ) {
    
            console.log("progress : " + progress);
            //fileSizes[ 'HDR' ] = humanFileSize( progress.total );
    
        } );
    }
    else{

    }
}
 // load hdri



 // Generate terrain
 const terrainSize = 100;
 const terrainPlain = new THREE.PlaneGeometry(terrainSize, terrainSize, 100, 100);

 
    for (let i = 0; i < terrainPlain.vertices.length; i++) {
     // Adjust the height based on a simple noise function
     terrainPlain.vertices[i].z = Math.random() * 1;
    }
    
    const material = new THREE.MeshStandardMaterial({ color: 0xdddddd, wireframe: false });
    let terrain = new THREE.Mesh(terrainPlain, material);
    terrainPlain.computeVertexNormals();
    terrain.rotation.set(-1.5708,0,0);
    terrain.position.set(0,-1.0,0);
    //scene.add(terrain);


    let t = 0, dT = 0.001;


function animate() {

    requestAnimationFrame(animate);
    t += dT;
    mixer?.update(0.003);

    composer.render(); // Use the composer for rendering
   

    UpdatePostRender()
}

let allUpdates = []

function UpdatePostRender() {
    AnimateAricrafts();
    RotatePlanet();
    Shoot();
    Update();
    ReposCamera(mouseX, mouseY);
}

let currentCameraX = 0, currentCameraY = 0;
function ReposCamera(x, y) {
    
    currentCameraX = lerp(currentCameraX, mouseX, .01);
    currentCameraY = lerp(currentCameraY, mouseY, .01);
    camera.lookAt(currentCameraX, currentCameraY,0);
}

function lerp(start, end, t) {
    return start * (1 - t) + end * t;
}

function RotatePlanet(){
    if(planet == null|| planet == undefined) return;
    planet.rotation.y += 0.0001;
}

function Update() {
    for (let index = 0; index < allUpdates.length; index++) {
        allUpdates[index].Update();
    }
}

function Remove(updateFunction){
    for (let index = 0; index < allUpdates.length; index++) {
        if(allUpdates[index] == updateFunction){
            if(index > allUpdates.lastIndexOf - 1){
                allUpdates[index] = allUpdates[allUpdates.lastIndexOf - 1];
            } 
            allUpdates.pop();
            return;
        }
    }
}

const shootDelay = 0.1;
let nextShoot = .2;
function Shoot(){

    if(firePoints == null) return;

    if(blasterGreen == null || blasterGreen == undefined) {
        return;
    }
    if(t > nextShoot){

        const worldPosition = new THREE.Vector3();
        firePoints.getWorldPosition(worldPosition);

        const worldRotation = new THREE.Quaternion();
        firePoints.getWorldQuaternion(worldRotation);

        let b = new Bullet(blasterGreen.scene, scene, worldPosition, worldRotation, 100);
        allUpdates.push(b)
        nextShoot = t + shootDelay;
        //console.log("Shoot...");
    }
}

function AnimateAricrafts(){
    MoveModel(glbModel, 20, .6, 8, .3, 25, .4, 2, .4, 1, .2, 0);
    MoveModel(tie, 8, .8, 20, 2, 12, 3, 7, .2, -.2, .1, 2);
}

function MoveModel(
    model, 
    x_speed_1, 
    x_speed_1_mag,
    x_speed_2,
    x_speed_2_mag,
    y_speed_1,
    y_speed_1_mag,
    y_speed_2,
    y_speed_2_mag,
    xTiltFactor,
    yTiltFactor,
    timeOffset
    ){
    if(model == null || model == undefined) return;

    let _t = t + timeOffset;
    let xMovement = Math.sin(_t * x_speed_1) * x_speed_1_mag + Math.sin(_t * x_speed_2) * x_speed_2_mag;
    let yMovement = Math.sin(_t * y_speed_1) * y_speed_1_mag + Math.sin(_t * y_speed_2) * y_speed_2_mag;

    model.position.set(
        xMovement,
        yMovement,
        model.position.z);

        model.rotation.z = -xMovement * xTiltFactor;
        model.rotation.x = yMovement * yTiltFactor;
}

function LoadTexture(path){
    const textureLoader = new THREE.TextureLoader();
    const texture = textureLoader.load(path);
    texture.flipY = false;
    return texture;
}

function DrawLine(position, direction) {
    // Create a material for the line (you can customize the color and other properties)
    const material = new THREE.LineBasicMaterial({ color: 0x00ff00 });

    // Create a geometry for the line
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([0, 0, 0, 0, 0, 5]); // Starting at (0,0,0) and pointing in the positive Z direction
    geometry.addAttribute('position', new THREE.BufferAttribute(vertices, 3));

    // Create the line using the material and geometry
    const gizmoLine = new THREE.Line(geometry, material);

    // Set the position and direction of the gizmo line
    //const position = new THREE.Vector3(10, 5, 3); // Replace with your desired position
    //const direction = new THREE.Vector3(0, 0, 1); // Replace with your desired direction
    gizmoLine.position.copy(position);

    // Calculate the rotation to align the line with the given direction
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
    gizmoLine.setRotationFromQuaternion(quaternion);

    // Add the gizmo line to your scene
    scene.add(gizmoLine);

}

animate();




