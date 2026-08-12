import { useState } from 'react'
import crewData from '../mock/crew.json'

type CertKey = keyof typeof CERT_META

const CERT_META: Record<string, {
  label: string
  full:  string
  image: string | null
  color: string
}> = {
  CKA: {
    label: 'CKA',
    full:  'Certified Kubernetes Administrator',
    image: 'https://images.credly.com/images/8b8ed108-e77d-4396-ac59-2504583b9d54/cka_from_cncfsite__281_29.png',
    color: '#3070d0',
  },
  CKAD: {
    label: 'CKAD',
    full:  'Certified Kubernetes Application Developer',
    image: 'https://images.credly.com/images/cc8adc83-1dc6-4d57-8e20-22171247e052/blob',
    color: '#2255bb',
  },
  CKS: {
    label: 'CKS',
    full:  'Certified Kubernetes Security Specialist',
    image: 'https://images.credly.com/images/9945dfcb-1cca-4529-85e6-db1be3782210/kubernetes-security-specialist-logo2.png',
    color: '#7722cc',
  },
  KCNA: {
    label: 'KCNA',
    full:  'Kubernetes and Cloud Native Associate',
    image: 'https://images.credly.com/images/f28f1d88-428a-47f6-95b5-7da1dd6c1000/KCNA_badge.png',
    color: '#2299ee',
  },
  KCSA: {
    label: 'KCSA',
    full:  'Kubernetes and Cloud Native Security Associate',
    image: 'https://images.credly.com/images/67dd8a95-8876-4051-9cb9-3d97c204f85a/image.png',
    color: '#9933cc',
  },
  PCA: {
    label: 'PCA',
    full:  'Prometheus Certified Associate',
    image: 'https://images.credly.com/images/c34436dc-1cfd-4125-a862-35f9c86ca17f/image.png',
    color: '#e05000',
  },
  ICA: {
    label: 'ICA',
    full:  'Istio Certified Associate',
    image: 'https://images.credly.com/images/d7d4ddc8-7df8-4c03-9343-507b51e0ef99/image.png',
    color: '#4466aa',
  },
  CGOA: {
    label: 'CGOA',
    full:  'Certified GitOps Associate',
    image: 'https://images.credly.com/images/7219d055-4e97-439c-b244-8fbe885fa06b/image.png',
    color: '#ee8800',
  },
  CAPA: {
    label: 'CAPA',
    full:  'Certified Argo Project Associate',
    image: 'https://images.credly.com/images/12624f9e-6b4a-43f0-b7a2-afb2c6cf8059/image.png',
    color: '#ee6600',
  },
  CCA: {
    label: 'CCA',
    full:  'Cilium Certified Associate',
    image: 'https://images.credly.com/images/729367b3-0344-4b00-a6da-53e1807f808a/image.png',
    color: '#00aadd',
  },
  OTCA: {
    label: 'OTCA',
    full:  'OpenTelemetry Certified Associate',
    image: 'https://images.credly.com/images/3d3f7131-83a4-4427-8a68-150ca90bcc23/blob',
    color: '#884488',
  },
  KCA: {
    label: 'KCA',
    full:  'Kyverno Certified Associate',
    image: 'https://images.credly.com/images/2592935a-d8fa-405d-b40a-711a75454fc2/image.png',
    color: '#227755',
  },
  CBA: {
    label: 'CBA',
    full:  'Certified Backstage Associate',
    image: 'https://images.credly.com/images/d84e4fb0-dc7f-4d79-b1eb-a8a973da4965/image.png',
    color: '#cc4488',
  },
  CNPA: {
    label: 'CNPA',
    full:  'Cloud Native Platform Engineering Associate',
    image: 'https://images.credly.com/images/bf3fc97e-a12c-4567-86ea-01639b9b15fb/blob',
    color: '#116688',
  },
  CNPE: {
    label: 'CNPE',
    full:  'Cloud Native Platform Engineer',
    image: null,
    color: '#224488',
  },
  LFCS: {
    label: 'LFCS',
    full:  'Linux Foundation Certified SysAdmin',
    image: 'https://images.credly.com/images/1e6611ca-8afe-4ecc-ad4d-305fba52ee7e/1_LFCS-600x600.png',
    color: '#e8c000',
  },
  KUBESTRONAUT: {
    label: 'Kubestronaut',
    full:  'Kubestronaut',
    image: 'https://images.credly.com/images/cd6c6449-6814-4613-a2d3-13cf4ac5be4f/image.png',
    color: '#4488ff',
  },
  GOLDEN_KUBESTRONAUT: {
    label: 'Golden Kubestronaut',
    full:  'Golden Kubestronaut',
    image: 'https://images.credly.com/images/1dba0197-1013-4f23-8918-9479f77172d6/blob',
    color: '#ffd700',
  },
}

const GOLDEN_KUBESTRONAUT_CERTS: CertKey[] = ['CKA', 'CKAD', 'CKS', 'KCNA', 'KCSA', 'PCA', 'ICA', 'CCA', 'CAPA', 'CGOA', 'CBA', 'OTCA', 'KCA', 'CNPA', 'CNPE', 'LFCS']
const KUBESTRONAUT_CERTS = ['CKA', 'CKAD', 'CKS', 'KCNA', 'KCSA']

type Rank = {
  title:    string
  subtitle: string
  insignia: string
  color:    string
  glow:     boolean
}

function getRank(certs: Record<string, { earned: boolean }>): Rank {
  const earned = GOLDEN_KUBESTRONAUT_CERTS.filter(c => certs[c]?.earned).length
  const isKb   = KUBESTRONAUT_CERTS.every(c => certs[c]?.earned)
  const isGK   = GOLDEN_KUBESTRONAUT_CERTS.every(c => certs[c]?.earned)

  if (isGK)        return { title: 'FLEET ADMIRAL',   subtitle: 'Golden Kubestronaut', insignia: '★★★★★', color: '#ffd700', glow: true  }
  if (isKb)        return { title: 'CAPTAIN',          subtitle: 'Kubestronaut',        insignia: '★★★☆☆', color: '#4488ff', glow: true  }
  if (earned >= 12) return { title: 'COMMANDER',       subtitle: 'Senior Operator',     insignia: '★★☆☆☆', color: '#88aaff', glow: false }
  if (earned >= 8)  return { title: 'LIEUTENANT',      subtitle: 'Certified Operator',  insignia: '◆◆◆◇◇', color: '#66ccbb', glow: false }
  if (earned >= 5)  return { title: 'ENSIGN',          subtitle: 'Junior Operator',     insignia: '◆◆◇◇◇', color: '#55aaaa', glow: false }
  if (earned >= 2)  return { title: 'CADET',           subtitle: 'In Training',         insignia: '◆◇◇◇◇', color: '#5a8aaa', glow: false }
  return              { title: 'RECRUIT',              subtitle: 'Unranked',            insignia: '◇◇◇◇◇', color: '#3a6080', glow: false }
}

function isKubestronaut(certs: Record<string, { earned: boolean }>): boolean {
  return KUBESTRONAUT_CERTS.every(c => certs[c]?.earned)
}

function isGoldenKubestronaut(certs: Record<string, { earned: boolean }>): boolean {
  return GOLDEN_KUBESTRONAUT_CERTS.every(c => certs[c]?.earned)
}

function CertBadge({ certKey, cert }: {
  certKey: string
  cert: { earned: boolean; expires?: string }
}) {
  const [tooltip, setTooltip] = useState(false)
  const meta = CERT_META[certKey]
  if (!meta) return null

  const expired = cert.earned && cert.expires
    ? new Date(cert.expires + '-01') < new Date()
    : false

  return (
    <div
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setTooltip(true)}
      onMouseLeave={() => setTooltip(false)}
    >
      <div style={{
        width: 72,
        height: 72,
        borderRadius: 6,
        border: `1px solid ${expired ? '#664400' : '#1a2a38'}`,
        background: expired ? 'rgba(20,10,0,0.9)' : 'rgba(5,12,22,0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        position: 'relative',
        cursor: 'default',
      }}>
        {cert.earned && meta.image ? (
          <img
            src={meta.image}
            alt={meta.label}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              filter: expired ? 'grayscale(1) brightness(0.4)' : 'none',
            }}
          />
        ) : cert.earned && !meta.image ? (
          <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <span style={{
              fontSize: 10,
              fontWeight: 'bold',
              color: '#c8e0f4',
              fontFamily: 'DM Mono, monospace',
              letterSpacing: 0.5,
              textAlign: 'center',
              lineHeight: 1.2,
              padding: '0 2px',
            }}>
              {meta.label}
            </span>
          </div>
        ) : (
          <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 3,
          }}>
            {/* Placeholder slot — locked badge shape */}
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <path
                d="M14 3L5 8v12l9 5 9-5V8L14 3z"
                stroke="#1a3040"
                strokeWidth="1.5"
                fill="#0d1a24"
              />
              <path
                d="M14 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"
                fill="#1a3040"
              />
            </svg>
            <span style={{
              fontSize: 7,
              color: '#1a3040',
              fontFamily: 'DM Mono, monospace',
              letterSpacing: 0.5,
              textAlign: 'center',
              lineHeight: 1.2,
              padding: '0 4px',
            }}>
              {meta.label}
            </span>
          </div>
        )}

        {expired && cert.earned && (
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            background: 'rgba(80,20,0,0.85)',
            fontSize: 7,
            color: '#cc6600',
            textAlign: 'center',
            fontFamily: 'DM Mono, monospace',
            padding: '1px 0',
          }}>
            EXP
          </div>
        )}
      </div>

      {tooltip && (
        <div style={{
          position: 'absolute',
          bottom: '110%',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0,5,15,0.96)',
          border: '1px solid #1a2a38',
          borderRadius: 4,
          padding: '5px 8px',
          whiteSpace: 'nowrap',
          zIndex: 100,
          pointerEvents: 'none',
        }}>
          <div style={{ color: '#c8e0f4', fontSize: 10, fontWeight: 'bold', fontFamily: 'DM Mono, monospace' }}>
            {meta.label}
          </div>
          <div style={{ color: '#5a8aaa', fontSize: 9, fontFamily: 'DM Mono, monospace', marginTop: 2 }}>
            {meta.full}
          </div>
          {cert.earned && cert.expires && (
            <div style={{ color: expired ? '#cc4400' : '#5a8aaa', fontSize: 8, fontFamily: 'DM Mono, monospace', marginTop: 2 }}>
              {expired ? 'Expired' : 'Expires'} {cert.expires}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function CrewPanel({ onClose }: { onClose: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const crew = crewData.crew
  const selected = crew.find(e => e.id === selectedId) ?? crew[0]

  const earnedCount = GOLDEN_KUBESTRONAUT_CERTS.filter(k => selected.certs[k as keyof typeof selected.certs]?.earned).length
  const golden = isGoldenKubestronaut(selected.certs)
  const kubestronaut = isKubestronaut(selected.certs)
  const rank = getRank(selected.certs)

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none',
      zIndex: 60,
    }}>
      {/* Backdrop */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,3,10,0.65)',
          pointerEvents: 'all',
        }}
        onClick={onClose}
      />

      {/* Panel */}
      <div style={{
        position: 'relative',
        pointerEvents: 'all',
        width: 1100,
        maxHeight: '90vh',
        background: 'rgba(2,8,20,0.97)',
        border: '1px solid #0d2038',
        borderTop: '2px solid #1a5080',
        borderRadius: 6,
        display: 'flex',
        overflow: 'hidden',
        fontFamily: 'DM Mono, monospace',
        boxShadow: '0 0 60px rgba(0,80,160,0.25), inset 0 0 40px rgba(0,20,50,0.5)',
      }}>
        {/* Scanline overlay */}
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,20,40,0.12) 2px, rgba(0,20,40,0.12) 4px)',
          pointerEvents: 'none',
          zIndex: 1,
        }} />

        {/* Crew list */}
        <div style={{
          width: 240,
          borderRight: '1px solid #0d2038',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}>
          <div style={{
            padding: '14px 18px 10px',
            borderBottom: '1px solid #0d2038',
            color: '#1a4060',
            fontSize: 11,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
          }}>
            Ops Crew
          </div>
          {crew.map(eng => {
            const active = (selectedId ?? crew[0].id) === eng.id
            const engRank = getRank(eng.certs)
            return (
              <div
                key={eng.id}
                onClick={() => setSelectedId(eng.id)}
                style={{
                  padding: '12px 18px',
                  cursor: 'pointer',
                  borderBottom: '1px solid #0d1e2c',
                  background: active ? 'rgba(20,60,100,0.45)' : 'transparent',
                  borderLeft: active ? `3px solid ${eng.color}` : '3px solid transparent',
                  transition: 'background 0.1s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: `${eng.color}33`,
                  border: `1px solid ${eng.color}99`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  fontWeight: 'bold',
                  color: eng.color,
                  flexShrink: 0,
                  boxShadow: engRank.glow ? `0 0 10px ${eng.color}66` : 'none',
                }}>
                  {eng.avatar}
                </div>
                <div>
                  <div style={{ color: active ? '#c8e4f8' : '#7aaabb', fontSize: 13, fontWeight: 'bold' }}>
                    {eng.name.split(' ')[0]}
                  </div>
                  <div style={{
                    fontSize: 10,
                    marginTop: 3,
                    letterSpacing: 0.8,
                    color: engRank.color,
                    opacity: engRank.glow ? 1 : 0.8,
                  }}>
                    {engRank.title}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Detail view */}
        <div style={{ flex: 1, overflow: 'auto', position: 'relative', zIndex: 2 }}>
          {/* Header */}
          <div style={{
            padding: '20px 24px 16px',
            borderBottom: '1px solid #0d2038',
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            background: rank.glow ? `linear-gradient(135deg, rgba(0,0,0,0), ${rank.color}0a)` : 'none',
          }}>
            <div style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: `${selected.color}22`,
              border: `2px solid ${selected.color}bb`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              fontWeight: 'bold',
              color: selected.color,
              flexShrink: 0,
              boxShadow: rank.glow ? `0 0 18px ${selected.color}55, 0 0 6px ${selected.color}88` : 'none',
            }}>
              {selected.avatar}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#c8e4f8', fontSize: 20, fontWeight: 'bold', letterSpacing: 0.5 }}>
                {selected.name}
              </div>
              <div style={{ color: '#5a8aaa', fontSize: 12, marginTop: 4, letterSpacing: 1 }}>
                {selected.role.toUpperCase()}
              </div>
            </div>
            {/* Rank badge */}
            <div style={{
              textAlign: 'right',
              borderLeft: `1px solid ${rank.color}33`,
              paddingLeft: 18,
            }}>
              <div style={{
                color: rank.color,
                fontSize: 15,
                fontWeight: 'bold',
                letterSpacing: 1.5,
                textShadow: rank.glow ? `0 0 12px ${rank.color}` : 'none',
              }}>
                {rank.title}
              </div>
              <div style={{
                color: rank.color,
                fontSize: 18,
                letterSpacing: 2,
                marginTop: 3,
                opacity: 0.85,
              }}>
                {rank.insignia}
              </div>
              <div style={{ color: '#5a8aaa', fontSize: 11, marginTop: 4, letterSpacing: 0.5 }}>
                {earnedCount}/{GOLDEN_KUBESTRONAUT_CERTS.length} certs · {rank.subtitle}
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: '#5a8aaa',
                cursor: 'pointer',
                fontSize: 18,
                padding: '4px 8px',
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>

          {/* Cert grid */}
          <div style={{ padding: '20px 24px' }}>
            <div style={{ color: '#5a8aaa', fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 16 }}>
              Combat Certifications
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, 72px)',
              gap: 12,
            }}>
              <CertBadge key="KUBESTRONAUT" certKey="KUBESTRONAUT" cert={{ earned: kubestronaut }} />
              <CertBadge key="GOLDEN_KUBESTRONAUT" certKey="GOLDEN_KUBESTRONAUT" cert={{ earned: golden }} />
              {GOLDEN_KUBESTRONAUT_CERTS.map(certKey => (
                <CertBadge
                  key={certKey}
                  certKey={certKey}
                  cert={selected.certs[certKey as keyof typeof selected.certs] ?? { earned: false }}
                />
              ))}
            </div>

            {/* Rank ladder */}
            <div style={{ marginTop: 24, borderTop: '1px solid #0d1e2c', paddingTop: 20 }}>
              <div style={{ color: '#5a8aaa', fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 14 }}>
                Rank Progression
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                {[
                  { key: 'RECRUIT',       certs: 0,  insignia: '◇', color: '#3a6080' },
                  { key: 'CADET',         certs: 2,  insignia: '◆', color: '#5a8aaa' },
                  { key: 'ENSIGN',        certs: 5,  insignia: '◆◆', color: '#55aaaa' },
                  { key: 'LIEUTENANT',    certs: 8,  insignia: '◆◆◆', color: '#66ccbb' },
                  { key: 'COMMANDER',     certs: 12, insignia: '◆◆◆◆', color: '#88aaff' },
                  { key: 'CAPTAIN',       certs: -1, insignia: '★★★', color: '#4488ff' },
                  { key: 'FLEET ADMIRAL', certs: -2, insignia: '★★★★★', color: '#ffd700' },
                ].map((r, i, arr) => {
                  const isCurrentRank = rank.title === r.key
                  const isPast = (() => {
                    const rankOrder = ['RECRUIT','CADET','ENSIGN','LIEUTENANT','COMMANDER','CAPTAIN','FLEET ADMIRAL']
                    return rankOrder.indexOf(rank.title) > rankOrder.indexOf(r.key)
                  })()
                  return (
                    <div key={r.key} style={{ display: 'flex', alignItems: 'center', flex: i < arr.length - 1 ? 1 : 0 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                        <div style={{
                          fontSize: 18,
                          color: isCurrentRank ? r.color : isPast ? r.color + 'aa' : '#1a3040',
                          textShadow: isCurrentRank && (r.key === 'CAPTAIN' || r.key === 'FLEET ADMIRAL') ? `0 0 10px ${r.color}` : 'none',
                          transition: 'color 0.2s',
                        }}>
                          {r.insignia}
                        </div>
                        <div style={{
                          fontSize: 9,
                          letterSpacing: 0.5,
                          color: isCurrentRank ? r.color : isPast ? '#3a6080' : '#1a2a38',
                          textAlign: 'center',
                          whiteSpace: 'nowrap',
                          fontWeight: isCurrentRank ? 'bold' : 'normal',
                        }}>
                          {r.key}
                        </div>
                      </div>
                      {i < arr.length - 1 && (
                        <div style={{
                          flex: 1,
                          height: 1,
                          background: isPast ? '#2a5a7a' : '#0d1e2c',
                          margin: '0 4px',
                          marginBottom: 14,
                        }} />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
