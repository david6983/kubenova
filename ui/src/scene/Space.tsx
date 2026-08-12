import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { BackSide, ShaderMaterial } from 'three'

const vertexShader = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const fragmentShader = `
varying vec3 vDir;
uniform float uTime;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i+vec3(0,0,0)), hash(i+vec3(1,0,0)), f.x),
        mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
        mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y),
    f.z
  );
}

// 1-octave fbm — half the noise calls vs 2 octaves
float fbm(vec3 p) {
  return noise(p) * 0.5 + noise(p * 2.1 + vec3(1.7, 9.2, 3.4)) * 0.25;
}

void main() {
  vec3 dir = vDir;
  float t = uTime * 0.008;

  // Single warp with one shared fbm sample for q — 2 fbm calls total
  float qBase = fbm(dir * 2.5 + vec3(0.0, 0.0, t));
  float f     = fbm(dir * 2.0 + vec3(qBase * 3.0, qBase * 1.5, t * 0.4));

  float cloud = smoothstep(0.3, 0.75, f);

  vec3 colDark   = vec3(0.02, 0.00, 0.08);
  vec3 colPurple = vec3(0.18, 0.02, 0.45);
  vec3 colBlue   = vec3(0.00, 0.10, 0.70);
  vec3 colCyan   = vec3(0.00, 0.45, 0.75);

  vec3 nebula = mix(colPurple, colBlue, smoothstep(0.0, 0.5, f));
  nebula      = mix(nebula,    colCyan,  smoothstep(0.5, 0.8, f));

  vec3 color = mix(colDark, nebula, cloud * 0.75);

  // Stars — two densities (no fbm, pure noise lookups)
  float s1    = noise(dir * 400.0);
  float s2    = noise(dir * 800.0 + vec3(3.7, 1.2, 5.5));
  float stars = pow(max(s1 - 0.94, 0.0) / 0.06, 3.0) * 2.5;
  stars      += pow(max(s2 - 0.97, 0.0) / 0.03, 2.0) * 1.5;
  color      += stars * vec3(0.85, 0.92, 1.0);

  gl_FragColor = vec4(color, 1.0);
}
`

export function Space() {
  const matRef    = useRef<ShaderMaterial>(null!)
  const uniforms  = useMemo(() => ({ uTime: { value: 0 } }), [])
  const frameSkip = useRef(0)

  useFrame((_, delta) => {
    // Nebula drifts at uTime*0.008 — invisible at ¼ framerate update
    if (!matRef.current) return
    frameSkip.current = (frameSkip.current + 1) % 4
    if (frameSkip.current === 0) matRef.current.uniforms.uTime.value += delta * 4
  })

  return (
    <mesh>
      <sphereGeometry args={[3000, 48, 32]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        side={BackSide}
        depthWrite={false}
      />
    </mesh>
  )
}
