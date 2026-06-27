uniform vec3 color_a, color_b; // Base color of the material
varying vec3 vPosition;
varying float vLighting;
varying float randomColor;

vec3 lenierlerp(vec3 a, vec3 b, float t){
    return vec3(
        a.x + (b.x - a.x) * t, 
        a.y + (b.y - a.y) * t,
        a.z + (b.z - a.z) * t);
}

void main() {
    // Apply lighting to the base color
    vec3 shadedColor = (lenierlerp(color_a, color_b, randomColor) * max(vLighting, .1));
    gl_FragColor = vec4(shadedColor, 1.0);
}
