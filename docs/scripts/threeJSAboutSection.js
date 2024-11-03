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

const dummy32x32Tex = LoadTexture("assets/texture/dummy_32x32.jpg");

// Get the container div
const container = document.getElementById('show-screen');

let w = container.clientWidth;
let h = container.clientHeight;

const scene = new THREE.Scene();

//#region Camera
const camera = new THREE.PerspectiveCamera( 60, w / h, 0.1, 30000);
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
//        color: { value: new THREE.Color(_color) },



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
let dynamicPlanetPostion = new THREE.Vector3(-100, -2000, -400);
let isSmallScreen = false;
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
            isSmallScreen = true;
            console.log(w);
            console.log("SMALL_SCREEN");
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
    // console.log("mouse move");
    // Calculate normalized mouse coordinates
    mouseX = (event.clientX / window.innerWidth) * 2 - 1;
    mouseY = -(event.clientY / window.innerHeight) * 2 + 1;

    
});

//#endregion


//#region Directional Light
const directionalLight = new THREE.DirectionalLight(0xffffff, .6);
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
            planet.position.set(100, -350, -200);
  

            let planetSurface = null;

            let planetAtmos = new THREE.MeshStandardMaterial({
                color: 0xff2233, 
                emissive: {r:0, g:0, b:0},
                transparent: true,
                opacity: .028
            })

            planet.traverse((node) => {
                console.log(node.name);
                if (node.isMesh) {
                    if(node.name == "planet"){
                        planetSurface = node.material;
                        planetSurface.map = dummy32x32Tex;
                        ///console.log(planetSurface);
                    }
                    else if(node.name == "atmos"){
                        node.material = planetAtmos;
                    }
                }
            });

            // load albedo
            LoadAsyncTexture("assets/texture/planet/planet_albedo_low.jpg", (tex) =>{
                planetSurface.map = tex;
                planetSurface.roughness = .1;
                planetSurface.metalness = .4;
                planetSurface.envMapIntensity = 0;

                planetSurface.color = {r:1, g:.3, b:.2};
  
                loadApplyTex("assets/texture/planet/planet_albedo_mid.jpg", planetSurface, "map",() => {
                    loadApplyTex("assets/texture/planet/planet_albedo_hig.jpg", planetSurface, "map",() => {

                    });
                });
            });

            // load normal 
            LoadAsyncTexture("assets/texture/planet/planet_normal_low.jpg", (tex) =>{
                planetSurface.normalMap = tex;

                loadApplyTex("assets/texture/planet/planet_normal_mid.jpg", planetSurface, "normalMap",() => {
                    loadApplyTex("assets/texture/planet/planet_normal_hig.jpg", planetSurface, "normalMap",() => {

                    });
                });
            });


            scene.add(planet);
            if(action != null || action != undefined){
                //action();
}
        }
    );
}

const loadApplyTex = (path, material, valueName, action) => {
    var a = LoadAsyncTexture(path, (tex) =>
    {
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            material[valueName] = tex;
            material.needsUpdate = true;
            action();
    });
};

function SkySphere(action) {
    shySphere = LoadGLBMoedl(
        'assets/models/skySphere.glb', (file) => {
            shySphere = file.scene;
            shySphere.position.set(0, 0, 0);
            shySphere.scale.set(500, 500, 500);
            shySphere.rotation.set(0, -3.1, 0);
    
            let skymaterial = new THREE.MeshBasicMaterial(
                {
                    color: 0x000000, 
                    emissive: {r:0, g:0, b:0},
                    map: dummy32x32Tex
                }
            );


            shySphere.traverse((node) => {
                console.log(node.name);
                if (node.isMesh) {
                    node.material = skymaterial;
                }
            });


            //AddTextureToMaterial(skymaterial, "assets/texture/sky_green_base.jpg", "map");

            var a = LoadAsyncTexture("assets/texture/sky/sky_base_low.jpg",(tex) =>{
                skymaterial["map"] = tex;
                skymaterial.color = {r:.25, g:.6, b:.3};
               // skymaterial.emissive = {r:.003, g:.02, b:.035};
                skymaterial.needsUpdate = true;

                loadApplyTex("assets/texture/sky/sky_base_mid.jpg", skymaterial,"map", () => {
                    loadApplyTex("assets/texture/sky/sky_base_hig.jpg", skymaterial, "map",() => {
                    });
                });
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
            file.scene.position.set(0, 0, -10);
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
                map: dummy32x32Tex,
                roughnessMap: dummy32x32Tex,
                aoMap: dummy32x32Tex
            });

            LoadAsyncTexture('assets/texture/xwing_Albedo.jpg', (tex) =>{
                tex.wrapS = THREE.RepeatWrapping;
                tex.wrapT = THREE.RepeatWrapping;
                baseMaterial.map = tex;
            });

            LoadAsyncTexture('assets/texture/xwing_Roughness.jpg', (tex) =>{
                tex.wrapS = THREE.RepeatWrapping;
                tex.wrapT = THREE.RepeatWrapping;
                baseMaterial.roughnessMap = tex;
            });

            LoadAsyncTexture('assets/texture/xwing_AO.jpg', (tex) =>{
                tex.wrapS = THREE.RepeatWrapping;
                tex.wrapT = THREE.RepeatWrapping;
                baseMaterial.aoMap = tex;
            });


            // AddTextureToMaterial(baseMaterial, 'assets/texture/xwing_Albedo.jpg', "map");
            // AddTextureToMaterial(baseMaterial, 'assets/texture/xwing_Roughness.jpg', "roughnessMap");
            // AddTextureToMaterial(baseMaterial, 'assets/texture/xwing_AO.jpg', "aoMap");

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
            file.scene.position.set(0, 1, -40);
            file.scene.scale.set(.7, .7, .7);
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
                emissive: 0x112233,
                emissiveIntensity: .1,
                aoMap: dummy32x32Tex,
                metalness: .2,
                roughness: .1,
                exposure: 3,
                wireframe: false,
                map: dummy32x32Tex,
                roughnessMap: dummy32x32Tex
            });

            // albedo
            LoadAsyncTexture("assets/texture/ti/tie_albedo.jpg", (tex) =>{
                tex.wrapS = THREE.RepeatWrapping;
                tex.wrapT = THREE.RepeatWrapping;
                baseMaterial.map = tex;
            });


            // roughness
            LoadAsyncTexture("assets/texture/ti/tie_roughness.jpg", (tex) =>{
                tex.wrapS = THREE.RepeatWrapping;
                tex.wrapT = THREE.RepeatWrapping;
                baseMaterial.roughnessMap = tex;
            });

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


            let surfaceMaterial = new THREE.MeshStandardMaterial({
                color: 0x222222,
                map: dummy32x32Tex
            });

            let engineGlow = new THREE.MeshStandardMaterial({
                color: 0x3333ff,
                emissive: 0x2222ff,
                emissiveIntensity: 2,
                map: dummy32x32Tex
            });

            

            starDestroyer.traverse((node) => {
                console.log(node.name);
                if (node.isMesh) {
                    if(node.name == "Ship"){
                        node.material = surfaceMaterial;
                    }

                    else if(node.name == "Engine"){
                        node.material = engineGlow;
                    }

                }
            });

            LoadAsyncTexture("assets/texture/starDestroyer/starDestroyer.jpg", (tex) =>{
                tex.wrapS = THREE.RepeatWrapping;
                tex.wrapT = THREE.RepeatWrapping;
                surfaceMaterial.map = tex;
            });


            starDestroyer2 = starDestroyer.clone();
            starDestroyer3 = starDestroyer.clone();

            starDestroyer.position.set(-50, 0, -60);
            starDestroyer2.position.set(10, -20, -40);
            starDestroyer3.position.set(-30, -30, -20);

            const size = 5;
            starDestroyer.scale.set(size * .7, size * .7, size * .7);
            starDestroyer2.scale.set(size, size, size);
            starDestroyer3.scale.set(size, size, size);

            starDestroyer.rotation.set(0, 1, 0);
            starDestroyer2.rotation.set(0, 2.5, 0);
            starDestroyer3.rotation.set(0, 1, 0);
    
            //  scene.add(starDestroyer2);
            scene.add(starDestroyer);
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

            deathStar.position.set(-100, -30, -50);

            const size = .3;
            deathStar.scale.set(size, size, size);

            deathStar.rotation.set(0, .6, 0);
            
            let deathStarMaterial = new THREE.MeshStandardMaterial(
                {
                    color: 0x444444,
                    metalness: .85,
                    roughness: .9,
                    envMapIntensity: .3,
                    emissive: 0x000000,
                    emissiveIntensity: 1,
                    map: dummy32x32Tex,
                    normalMap: dummy32x32Tex,
                    emissiveMap: dummy32x32Tex,
                    normalScale: new THREE.Vector2(.2, .2)
                }
            );

            
            deathStar.traverse((node) => {
                console.log(node.name);
                if (node.isMesh) {
                    node.material = deathStarMaterial;
                }
            });

            //console.log(deathStarMaterial);

            // load albedo
            LoadAsyncTexture("assets/texture/deathStar/deathstar_albedo_low.jpg", (tex) =>{
                tex.wrapS = THREE.RepeatWrapping;
                tex.wrapT = THREE.RepeatWrapping;
                deathStarMaterial.map = tex;
                loadApplyTex("assets/texture/deathStar/deathstar_albedo.jpg", deathStarMaterial, "map",() => {
                });
            });


            // emission map
            LoadAsyncTexture("assets/texture/deathStar/deathstar_emi_low.jpg", (tex) =>{
                tex.wrapS = THREE.RepeatWrapping;
                tex.wrapT = THREE.RepeatWrapping;
                deathStarMaterial.emissiveMap = tex;
                deathStarMaterial.emissive = {r:1, g:1, b:1};
                loadApplyTex("assets/texture/deathStar/deathstar_emi.jpg", deathStarMaterial, "emissiveMap",() => {
                });
            });

            

              // normal map
              LoadAsyncTexture("assets/texture/deathStar/deathstar_normal_low.jpg", (tex) =>{
                tex.wrapS = THREE.RepeatWrapping;
                tex.wrapT = THREE.RepeatWrapping;
                deathStarMaterial.normalMap = tex;
                loadApplyTex("assets/texture/deathStar/deathstar_normal.jpg", deathStarMaterial, "normalMap",() => {
                });
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



//#endregion

//#region load tie fighter

//#endregion
function LoadWorldHDRI(onLoad) {

    if(hdrEquirectangularMap == null){

    let hdrEquirectangularMap = hdriLoader.load( 'assets/texture/hdri/lighting_2.hdr', function (hdrImage) {
    
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
    // Check if rockShaderMaterial and its uniforms are defined
    if (isSmallScreen != true && rockShaderMaterial && rockShaderMaterial.uniforms && rockShaderMaterial.uniforms.time) {
        rockShaderMaterial.uniforms.time.value += dT * 100;  // Increment time
        console.log("should move");
    } else {
        console.log("rockShaderMaterial or time uniform is not defined yet.");
    }
}

function UpdateInstanceRotateion(time, allMatrices) {
    const rotationSpeed = 0.01; // Adjust the speed of rotation

    // Iterate over each matrix and update its rotation
    for (let i = 0; i < allMatrices.length; i++) {
        let matrix =  new THREE.Matrix4();

        // Define the axis of rotation (for example, Y-axis)
        const axis = new THREE.Vector3(0, 1, 0);

        // Define the rotation angle based on time
        const angle = rotationSpeed * time;

        // Create a quaternion representing the rotation
        const deltaRotation = new THREE.Quaternion().setFromAxisAngle(axis, angle);

        let currentRotation = new THREE.Quaternion().setFromEuler(allMatrices[i].rot)

        // Combine the current rotation with the delta rotation
        const newRotation = new THREE.Quaternion();
        newRotation.multiplyQuaternions(deltaRotation, currentRotation);

        // Apply the new rotation to the matrix
       // matrix.compose(allMatrices[i].pos, newRotation.multiplyQuaternions(deltaRotation, currentRotation), allMatrices[i].scale);


       matrix.compose(new THREE.Vector3(0,0,0), currentRotation, new THREE.Vector3(1,1,1));


        instancedMesh.setMatrixAt(i, matrix);
        
    }

}

let allUpdates = []

function UpdatePostRender() {
    AnimateAricrafts();
    RotatePlanet();
    //UpdateInstanceRotateion(t, allMatricses);
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

async function LoadAsyncTexture(path, callback) {
    return new Promise((resolve, reject) => {
        const textureLoader = new THREE.TextureLoader();
        textureLoader.load(path, (texture) => {
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.flipY = false;
            if (callback && typeof callback === 'function') {
                callback(texture);
            }
            resolve(texture);
        }, undefined, (error) => {
            reject(error);
        });
    });
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

async function loadShaderFile(url) {
    const response = await fetch(url);
    return await response.text();
}




var allMatricses = [];
let instancedMesh = [];



async function DrawInstancedTest(geometry, count, r, spread,  _color, scale_x, scale_y) {


    let rotationSpeeds = new Float32Array(count);
    // Create a cube geometry
//geometry = new THREE.BoxGeometry(1, 1, 1);

// Create a material for the cube
//let rockMat = new THREE.MeshStandardMaterial({ color: _color, roughness:1, metalness: .3 });


//instancedMesh = new THREE.InstancedMesh(geometry, material, count);



let instanceMaterial = await InstancedRockMaterial();


instancedMesh = new THREE.InstancedMesh(geometry, instanceMaterial, count);

        // Randomly position and scale each instance
        for (let i = 0; i < count; i++) {
            let matrix = new THREE.Matrix4();

            let maxDistance = r;
            let spawnOffset = spread;
            let dist = maxDistance + lerp(-spawnOffset, spawnOffset, Math.random());

            let position = new THREE.Vector3(0,lerp(-20,20, Math.random()),dist);

            const angle = lerp(-5,  .2, Math.random()); // Random angle between 0 and 2π

        // Generate random axis of rotation
        const axis = new THREE.Vector3(
            0, // Random X component between -0.5 and 0.5
            1, // Random Y component between -0.5 and 0.5
            0  // Random Z component between -0.5 and 0.5
        ).normalize(); // Normalize to ensure it's a unit vector

        // Create a quaternion representing the rotation
        let quaternion = new THREE.Quaternion().setFromAxisAngle(axis, angle);

        // Apply the rotation to the vector



        // Random position between -5 and 5 for each axis
        // let position = new THREE.Vector3(
        //     Math.random() * 10 - 5,
        //     Math.random() * 2 - 1,
        //     Math.random() * 10 - 5
        //     );
            position.applyQuaternion(quaternion);

        const offset = new THREE.Vector3(100, -250, -200);
        position.add(offset);

        // Random rotation angles in radians
        let rotation = new THREE.Euler(
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2
        );

        let sizScale = lerp(scale_x, scale_y, Math.random());
        // Random scale between 0.5 and 1.5 for each axis
        let scale = new THREE.Vector3(sizScale,sizScale,sizScale);

        rotationSpeeds[i] = ( Math.random() * 2.0) - 1.0;
        // Set position, rotation, and scale to the matrix
        matrix.compose(position, new THREE.Quaternion().setFromEuler(rotation), scale);

            instancedMesh.setMatrixAt(i, matrix);
            instancedMesh.geometry.setAttribute('rotationSpeed', new THREE.InstancedBufferAttribute(rotationSpeeds, 1));
        }
    /// instancedMesh.setAttribute('rotationSpeed', new THREE.InstancedBufferAttribute(rotationSpeeds, 1));
      //  rotationSpeeds.push( Math.random() * 2.0 - 1.0);
    // Add the InstancedMesh to the scene
    scene.add(instancedMesh);

}

let spareRock = null;
async function LoadSpaceRocks(action) {

    await InstancedRockMaterial();

    LoadGLBMoedl(
        'assets/models/spaceRock.glb', (file) => {
            spareRock = file.scene;

            let mat = new THREE.MeshStandardMaterial({ color: 0x555555, wireframe: false });


           // scene.add(file.scene);
            if(action != null || action != undefined){
                action(file.scene.children[0].geometry, rockShaderMaterial);
            }
        }
    );
}


var rockShaderMaterial = null;
async function InstancedRockMaterial() {
    if (rockShaderMaterial) {
        console.log("Reusing existing material");
        return rockShaderMaterial;
    }

    console.log("Creating new instance material...");
    const vertexShader = await loadShaderFile('shaders/rockVertexShader.glsl');
    const fragmentShader = await loadShaderFile('shaders/rockFragmentShader.glsl');

    // Create the custom shader material
    rockShaderMaterial = new THREE.ShaderMaterial({
        uniforms: {
            color: { value: new THREE.Color(0x602f1f) },
            time: { value: 0.0 }
        },
        vertexShader: vertexShader,
        fragmentShader: fragmentShader
    });

    return rockShaderMaterial;
}

document.addEventListener("DOMContentLoaded", function() {
 console.log("page_loaded");


 // load all the modals in order
SkySphere(
    () =>{
        if(isSmallScreen == false){
            LoadAllModels();
        }
    }
    );

async function LoadAllModels() {
    LoadPlanet(
        LoadDeathStar(
            LoadStarDestroyer(
                LoadTie(
                    LoadXWing(
                        () => {
                            LoadSpaceRocks(
                                (mesh)=>{
                                DrawInstancedTest(mesh, 900, 500, 100, 0x602f1f, 2, 3);
                                DrawInstancedTest(mesh, 1000, 1000, 300, 0x9a4c32, 2, 3);
                                DrawInstancedTest(mesh, 2500, 2500, 800, 0x602f1f, 2, 4);
                            });
                            console.log("models loaded");
                        }
                    )
                )
            )
        )
    )
}

 animate();
});
