precision mediump float;

#pragma glslify: NoiseSettings = require(../tools/settings/noiseSettings.glsl)
#pragma glslify: noiseSupplier = require(../tools/suppliers/simplexNoiseSupplier.glsl)
#pragma glslify: polarWarp = require(../tools/domainWarp.glsl)
#pragma glslify: Modifications = require(../tools/settings/modifications.glsl)

#define PI 3.1415926538

varying vec3 fragColor;

uniform NoiseSettings source;
uniform NoiseSettings angleControl;
uniform NoiseSettings amountControl;

uniform int octaves;

uniform float scale;
uniform vec2 viewport;

uniform vec2 position;

uniform float warpAmount;
uniform int iterations;

#define RECURSIVE_WARP(p, angle, amount, iterations) for(int i = 0; i < (iterations); i++) { p = polarWarp(p, (angle), (amount), warpAmount); }

vec2 recursiveWarp(vec2 p, NoiseSettings angleControl, NoiseSettings amountControl) {
    if(iterations == 0) {
    } else if(iterations == 1) {
        RECURSIVE_WARP(p, angleControl, amountControl, 1);
    } else if(iterations == 2) {
        RECURSIVE_WARP(p, angleControl, amountControl, 2);
    } else if(iterations == 3) {
        RECURSIVE_WARP(p, angleControl, amountControl, 3);
    } else {
        RECURSIVE_WARP(p, angleControl, amountControl, 4);
    }
    return p;
}

vec3 getColor(vec2 coord, NoiseSettings source, NoiseSettings angle, NoiseSettings amount) {
    vec2 p = recursiveWarp(coord, angle, amount);
    float n = noiseSupplier(source, vec3(p.xy, 0));
    float r = noiseSupplier(angle, vec3(p.xy, 0));
    float g = noiseSupplier(amount, vec3(p.xy, 0));
    return vec3(n, g, r) * n;
}

void main()
{
    float proportions = viewport.y / viewport.x;
    vec2 center = vec2(0.5, 0.5 * proportions);
    vec2 pos = vec2(
        gl_FragCoord.x / viewport.x, 
       (gl_FragCoord.y / viewport.y) * proportions
    );

    pos -= center;
    pos *= scale;
    pos += center;
    pos += position;

    vec3 color = getColor(pos, source, angleControl, amountControl);
    gl_FragColor = vec4(color, 1.0);
}
