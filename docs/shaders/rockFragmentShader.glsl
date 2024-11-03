uniform vec3 color; // Base color of the material
varying vec3 vPosition;
varying float vLighting;

void main() {
    // Apply lighting to the base color
    vec3 shadedColor = color * vLighting;
    gl_FragColor = vec4(shadedColor, 1.0);
}
