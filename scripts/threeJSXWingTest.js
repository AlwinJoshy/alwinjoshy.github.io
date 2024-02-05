import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.117.1/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/postprocessing/RenderPass.js';
//import { UnrealBloomPass } from 'https://cdn.jsdelivr.net/npm/three@0.117.1/examples/jsm/postprocessing/UnrealBloomPass.js';

import { UnrealBloomPass } from './UnrealBloomPass.js';

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
const container = document.getElementById('display-container');

let w = container.clientWidth;
let h = container.clientHeight;

const scene = new THREE.Scene();

//#region Camera
const camera = new THREE.PerspectiveCamera( 75, w / h, 0.1, 1000);
camera.position.set(5, 5, 4);
camera.lookAt(0,0,-2);
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

//#region Add a RenderPass to render the scene
const renderPass = new RenderPass(scene, camera);
renderPass.clear = true;
renderPass.alpha = true;
const composer = new EffectComposer(renderer);
composer.addPass(renderPass);
let bloomPass = new UnrealBloomPass(
    new THREE.Vector2(w * 2, h * 2),
    5,
    1.3,
    .3
);

///bloomPass.strength = 2.5;
//bloomPass.threshold = 0.2;
//bloomPass.radius = 1.3;
composer.addPass(bloomPass);
//#endregion

//#region Directional Light
const directionalLight = new THREE.DirectionalLight(0xffffff, .3);
directionalLight.position.set(10, 10, 10);
directionalLight.rotation.set(1.3,0,0);
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



let torusGeometry = new THREE.TorusKnotGeometry( 18, 8, 200, 40, 1, 3 );
let torusMaterial = new THREE.MeshStandardMaterial( {
    color: 0xffffff,
    metalness: 1,
    roughness: 0.5
} );

let torusMesh = new THREE.Mesh( torusGeometry, torusMaterial );
torusMesh.scale.set(.3,.3,.3);
//scene.add(torusMesh);


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
   
       const material = new THREE.MeshStandardMaterial({
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
   
       LoadWorldHDRI((texture)=>{
           material.envMap = texture, // Use the texture property
           material.needsUpdate = true;
       });
   
       // Play the animations
       mixer = new THREE.AnimationMixer(glbModel);
       file.animations.forEach((clip) => {
           mixer.clipAction(clip).play();
       });
       
       // Add the model to the scene
       scene.add(file.scene);
   
   //    postProcess(file.scene);
}

let blasterGreen = LoadGLBMoedl(
    '/assets/models/laser_blast.glb', (file) => {

        blasterGreen = file;

        file.scene.position.set(0, 0, 0);
        file.scene.scale.set(.05, .05, .1);
        file.scene.rotation.set(0, 0, 0);

        const material = new THREE.MeshStandardMaterial({
            color: 0x55ff55,
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

        //scene.add(file.scene);
    }
);


let glbModel = LoadGLBMoedl(
    '/assets/models/x-wing.glb', (file) => {
        glbModel = file.scene;
        file.scene.position.set(0, 0, 0);
        file.scene.scale.set(.5, .5, .5);
        file.scene.rotation.set(0, 3.14159, 0);

        AddStandardTexture(
            file,
            '/assets/texture/xwing_Albedo.png',
            '/assets/texture/xwing_Roughness.png',
            '/assets/texture/xwing_AO.png', 
            generalMaterialProperty
        );
    }
);

let firePoints;
let tie = LoadGLBMoedl(
    '/assets/models/tie_fighter.glb', (file) => {
        tie = file.scene;
        file.scene.position.set(0, 1, -15);
        file.scene.scale.set(.5, .5, .5);
        file.scene.rotation.set(0, 0, 0);

        const aircraftModel = file.scene.getObjectByName('tie_fighter');
        firePoints = aircraftModel.getObjectByName('fire_point');

        const worldPosition = new THREE.Vector3();
        firePoints.getWorldPosition(worldPosition);

        let greenPointLight = new THREE.PointLight(0xff0000, 1, 10);
        greenPointLight.position.copy(worldPosition);
        file.scene.add(greenPointLight);


        AddStandardTexture(
            file,
            '/assets/texture/tie_Albedo.png',
            '/assets/texture/tie_Roughness.png',
            '/assets/texture/tie_AO.png', 
            generalMaterialProperty
        );
    }
);

//#region load tie fighter

//#endregion

function LoadWorldHDRI(onLoad) {

    if(hdrEquirectangularMap == null){

    let hdrEquirectangularMap = hdriLoader.load( '/assets/texture/hdri/sky_desert_gree.hdr', function (hdrImage) {
    
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


    let t = 0


function animate() {

    requestAnimationFrame(animate);
    t += 0.001;
    mixer?.update(0.003);

    composer.render(); // Use the composer for rendering
   

    UpdatePostRender()
}

let allUpdates = []

function UpdatePostRender() {
    AnimateAricrafts();
    Shoot();

    Update();
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

let nextShoot = .2;
function Shoot(){
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
        nextShoot = t + .05;
        //console.log("Shoot...");
    }
}

function AnimateAricrafts(){
    MoveModel(glbModel, 20, .6, 8, .3, 25, .4, 2, .4, 1, .2, 0);
    MoveModel(tie, 8, .8, 20, 2, 6, .4, 7, .2, -.2, .3, 2);
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


