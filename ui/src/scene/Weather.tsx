import { useRef, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { ShaderMaterial, Color, BackSide, AdditiveBlending, Mesh } from 'three'

export type ClusterHealth = 'good' | 'warn' | 'critical'

const stormVert = `
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const stormFrag = `
varying vec3 vPos;
uniform float uTime;
uniform float uIntensity;
uniform vec3  uColor;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1); p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i),              hash(i+vec3(1,0,0)), f.x),
        mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
        mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  return noise(p) * 0.5 + noise(p * 2.1 + 0.31) * 0.25;
}

void main() {
  vec3 n = normalize(vPos);
  float c1 = fbm(n * 2.2 + vec3(uTime * 0.035, uTime * 0.018, uTime * 0.026));
  float c2 = fbm(n * 4.1 - vec3(uTime * 0.055, 0.0, uTime * 0.038) + 5.3);
  float storm = smoothstep(0.32, 0.72, c1 * 0.6 + c2 * 0.4);
  float horizon = clamp(1.0 - abs(n.y) * 1.4, 0.0, 1.0);
  storm *= 0.3 + 0.7 * horizon;
  float alpha = storm * uIntensity * 0.65;
  gl_FragColor = vec4(uColor * (0.7 + storm * 0.5), alpha);
}
`

const FOG_TARGET   = { good: new Color('#0d0025'), warn: new Color('#1a0a00'), critical: new Color('#1a0005') }
const STORM_TARGET = { good: new Color('#110033'), warn: new Color('#cc4400'), critical: new Color('#cc0011') }
const INTENSITY    = { good: 0, warn: 0.28, critical: 0.62 }

export function Weather({ health }: { health: ClusterHealth }) {
  const { scene } = useThree()
  const matRef  = useRef<ShaderMaterial>(null!)
  const meshRef = useRef<Mesh>(null!)

  const uniforms = useMemo(() => ({
    uTime:      { value: 0 },
    uIntensity: { value: 0 },
    uColor:     { value: new Color(STORM_TARGET.good) },
  }), [])

  const fogColor  = useRef(new Color(FOG_TARGET.good))
  const frameSkip = useRef(0)

  useFrame((_, delta) => {
    const speed = delta * 1.2
    const mat   = matRef.current
    const mesh  = meshRef.current

    if (mat) {
      mat.uniforms.uIntensity.value +=
        (INTENSITY[health] - mat.uniforms.uIntensity.value) * speed
      mat.uniforms.uColor.value.lerp(STORM_TARGET[health], speed * 0.5)

      // Hide the sphere when intensity is negligible — saves entire fragment pass
      if (mesh) mesh.visible = mat.uniforms.uIntensity.value > 0.005

      frameSkip.current = (frameSkip.current + 1) % 2
      if (frameSkip.current === 0 && mat.uniforms.uIntensity.value > 0.005) {
        mat.uniforms.uTime.value += delta * 2
      }
    }

    const fog = (scene.fog as any)
    if (fog?.color) {
      fogColor.current.lerp(FOG_TARGET[health], speed * 0.4)
      fog.color.copy(fogColor.current)
    }
  })

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[1100, 14, 14]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={stormVert}
        fragmentShader={stormFrag}
        uniforms={uniforms}
        side={BackSide}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </mesh>
  )
}
