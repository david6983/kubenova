import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { ShaderMaterial, Mesh, BackSide, DoubleSide, AdditiveBlending, Group } from 'three'

// ─── Gas Giant ────────────────────────────────────────────────────────────────

const planetVert = `
varying vec3 vPos;
varying vec2 vUv;
void main() {
  vPos = position;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const gasGiantFrag = `
varying vec3 vPos;
varying vec2 vUv;
uniform float uTime;

float hash(float n) { return fract(sin(n) * 43758.5453); }
float noise(float x) {
  float i = floor(x); float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash(i), hash(i + 1.0), f);
}

void main() {
  float lat = vUv.y;
  float band  = noise(lat * 12.0 + noise(lat * 6.0  + uTime * 0.03) * 0.3);
  float band2 = noise(lat * 22.0 + 3.7 + uTime * 0.018);

  vec3 c1 = vec3(0.05, 0.02, 0.28);
  vec3 c2 = vec3(0.18, 0.04, 0.48);
  vec3 c3 = vec3(0.06, 0.12, 0.55);
  vec3 c4 = vec3(0.02, 0.06, 0.32);

  vec3 col = mix(c1, c2, band);
  col = mix(col, c3, band2 * 0.5);
  col = mix(col, c4, smoothstep(0.42, 0.58, lat));
  col += vec3(0.02, 0.0, 0.08) * pow(1.0 - abs(lat - 0.5) * 2.0, 3.0);

  float limb = max(dot(normalize(vPos), vec3(0.3, 0.5, 0.8)), 0.0);
  col *= 0.3 + 0.7 * limb;
  gl_FragColor = vec4(col, 1.0);
}
`

const glowVert = `varying vec3 vN; void main() { vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`
const glowFrag = `varying vec3 vN; uniform vec3 uColor; void main() { float i = pow(0.7 - dot(vN, vec3(0,0,1)), 3.0); gl_FragColor = vec4(uColor, i * 0.6); }`
const ringVert = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`
const ringFrag = `
varying vec2 vUv; uniform vec3 uColor;
void main() {
  float r = abs(vUv.x - 0.5) * 2.0;
  float alpha = smoothstep(0.0, 0.1, r) * smoothstep(1.0, 0.82, r);
  float bands = 0.5 + 0.5 * sin(r * 80.0);
  gl_FragColor = vec4(uColor * (0.6 + bands * 0.4), alpha * 0.5);
}
`

function GasGiant() {
  const planetRef = useRef<Mesh>(null!)
  const matRef = useRef<ShaderMaterial>(null!)
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), [])

  useFrame((_, delta) => {
    if (matRef.current) matRef.current.uniforms.uTime.value += delta
    if (planetRef.current) planetRef.current.rotation.y += delta * 0.04
  })

  const radius = 180

  return (
    <group position={[-600, 80, 1400]}>
      <mesh ref={planetRef}>
        <sphereGeometry args={[radius, 24, 24]} />
        <shaderMaterial ref={matRef} vertexShader={planetVert} fragmentShader={gasGiantFrag} uniforms={uniforms} />
      </mesh>
      <mesh scale={[1.14, 1.14, 1.14]}>
        <sphereGeometry args={[radius, 16, 16]} />
        <shaderMaterial vertexShader={glowVert} fragmentShader={glowFrag}
          uniforms={{ uColor: { value: [0.15, 0.08, 0.9] } }}
          side={BackSide} transparent depthWrite={false} blending={AdditiveBlending} />
      </mesh>
      <mesh rotation={[Math.PI * 0.12, 0, Math.PI * 0.1]}>
        <ringGeometry args={[radius * 1.45, radius * 2.5, 48]} />
        <shaderMaterial vertexShader={ringVert} fragmentShader={ringFrag}
          uniforms={{ uColor: { value: [0.35, 0.25, 0.85] } }}
          side={DoubleSide} transparent depthWrite={false} />
      </mesh>
    </group>
  )
}

// ─── Drifting Asteroids ───────────────────────────────────────────────────────

const moonFrag = `
varying vec3 vPos;
float hash(vec3 p) { p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x) {
  vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
void main() {
  vec3 n = normalize(vPos);
  float c = noise(n*6.0)*0.5 + noise(n*15.0)*0.3 + noise(n*40.0)*0.2;
  vec3 dark = vec3(0.07,0.06,0.10); vec3 light = vec3(0.20,0.18,0.25);
  vec3 col = mix(dark, light, c);
  col *= 0.1 + 0.9 * max(dot(n, normalize(vec3(1.0,0.6,0.4))), 0.0);
  gl_FragColor = vec4(col, 1.0);
}
`

interface AsteroidData {
  x: number       // start X
  y: number       // fixed Y
  z: number       // fixed Z — deep background
  radius: number
  vx: number      // drift speed X
  vy: number      // drift speed Y
  rotX: number
  rotY: number
  rotZ: number
}

const BOUND = 800  // wrap boundary in X

function Asteroid({ data }: { data: AsteroidData }) {
  const ref = useRef<Group>(null!)
  const pos = useRef({ x: data.x, y: data.y })

  useFrame((_, delta) => {
    if (!ref.current) return
    pos.current.x += data.vx * delta
    pos.current.y += data.vy * delta
    // Wrap horizontally so asteroids keep flowing
    if (pos.current.x > BOUND)  pos.current.x -= BOUND * 2
    if (pos.current.x < -BOUND) pos.current.x += BOUND * 2
    ref.current.position.x = pos.current.x
    ref.current.position.y = pos.current.y
    ref.current.rotation.x += data.rotX * delta
    ref.current.rotation.y += data.rotY * delta
    ref.current.rotation.z += data.rotZ * delta
  })

  return (
    <group ref={ref} position={[data.x, data.y, data.z]}>
      <mesh>
        <dodecahedronGeometry args={[data.radius, 1]} />
        <shaderMaterial vertexShader={planetVert} fragmentShader={moonFrag} />
      </mesh>
    </group>
  )
}

export function Decorations() {
  return <GasGiant />
}
