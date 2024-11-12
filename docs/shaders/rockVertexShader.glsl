uniform float time;
attribute float rotationSpeed; // New attribute for rotation speed
varying vec3 vPosition;
varying float vLighting; // Pass lighting intensity to fragment shader
varying float randomColor;

void main() {
    vec3 lightDirection = vec3(0.2, 1, -1);

    vPosition = position;  // Pass position to the fragment shader

    // Rotation around the local y-axis using a rotation matrix, scaled by rotationSpeed
    float angle = time * rotationSpeed * 0.2; // Each instance rotates at its own speed
    mat4 rotationMatrix = mat4(
        cos(angle), 0.0, sin(angle), 0.0,
        0.0, 1.0, 0.0, 0.0,
        -sin(angle), 0.0, cos(angle), 0.0,
        0.0, 0.0, 0.0, 1.0
    );

    // Apply instance transformation, then rotation


    vec4 modelPosition = instanceMatrix * rotationMatrix * vec4(position, 1.0);

    vec4 wObjPos = instanceMatrix * vec4(0.0,0.0,0.0,1.0);
    modelPosition.y += sin(time * .2 + wObjPos.y * rotationSpeed) * 2.2;

    // Transform the normal to world space
    vec3 transformedNormal = normalize((instanceMatrix * rotationMatrix * vec4(normal, 0.0)).xyz);

    // Calculate diffuse lighting intensity
    float diffuse = max(dot(transformedNormal, normalize(lightDirection)), 0.0);

    // Pass the diffuse lighting value to the fragment shader
    vLighting = diffuse;
    randomColor = sin(wObjPos.x) * 0.5 + 0.5;
    // Final position calculations
    vec4 viewPosition = viewMatrix * modelPosition;
    vec4 projectedPosition = projectionMatrix * viewPosition;
    gl_Position = projectedPosition;
}
