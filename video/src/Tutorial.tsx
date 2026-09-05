import React, {useEffect, useState} from 'react';
import {
  AbsoluteFill, Audio, Img, Sequence, interpolate, spring, staticFile,
  useCurrentFrame, useVideoConfig, Easing, continueRender, delayRender,
} from 'remotion';

/* MEGABALL "How to play" — simple illustrated scenes.
 * Every scene is the same stylised phone table on the right and a
 * step card on the left. The table is drawn with divs so the video
 * needs no captured footage; positions are in "table units" (440 x 950). */

export const FPS = 30;

const C = {
  cyan: '#6eebff', yellow: '#ffdc28', orange: '#ff9c28', pink: '#ff46a0',
  white: '#ffffff', ice: '#c8f5ff', green: '#8cff9a', grey: '#c9cbd6', bg: '#05060c',
};
const IMPACT = 'Impact, "Arial Narrow Bold", sans-serif';
const PIXEL = 'KenPixel, monospace';

const usePixelFont = () => {
  const [handle] = useState(() => delayRender('kenpixel'));
  useEffect(() => {
    const f = new FontFace('KenPixel', `url(${staticFile('fonts/kenpixel.woff')})`);
    f.load().then((face) => { document.fonts.add(face); continueRender(handle); })
      .catch(() => continueRender(handle));
  }, [handle]);
};

const clamp = {extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const};
const easeIn = Easing.in(Easing.quad);
const easeOut = Easing.out(Easing.quad);

/* ------------------------------------------------------------- type bits -- */

const Stroke: React.FC<{text: string; size: number; color: string; style?: React.CSSProperties}> =
  ({text, size, color, style}) => (
    <div style={{
      fontFamily: IMPACT, fontSize: size, color, lineHeight: 0.92, letterSpacing: 1,
      WebkitTextStroke: `${size * 0.09}px #08080e`, paintOrder: 'stroke fill',
      textShadow: `${size * 0.06}px ${size * 0.07}px 0 #08080e`, whiteSpace: 'nowrap', ...style,
    }}>{text}</div>
  );

const Slab: React.FC<{text: string; color: string; size?: number; style?: React.CSSProperties}> =
  ({text, color, size = 30, style}) => (
    <div style={{
      fontFamily: PIXEL, fontSize: size, color, background: 'rgba(6,8,16,0.92)',
      border: `3px solid ${color}`, borderRadius: 10, padding: '8px 18px', letterSpacing: 1,
      whiteSpace: 'nowrap', display: 'inline-block', ...style,
    }}>{text}</div>
  );

/* Comic burst word that pops on a spring and fades. Lives in table coords. */
const Burst: React.FC<{text: string; color: string; x: number; y: number; size?: number; hold?: number}> =
  ({text, color, x, y, size = 64, hold = 40}) => {
    const frame = useCurrentFrame();
    const {fps} = useVideoConfig();
    const s = spring({frame, fps, config: {damping: 9, stiffness: 260, mass: 0.7}});
    const fade = interpolate(frame, [hold, hold + 12], [1, 0], clamp);
    return (
      <div style={{position: 'absolute', left: x, top: y, transform: `translate(-50%,-50%) scale(${s}) rotate(-6deg)`, opacity: fade, zIndex: 20}}>
        <Img src={staticFile('art/burst.png')} style={{
          position: 'absolute', left: '50%', top: '50%', width: size * 4, height: size * 4,
          transform: 'translate(-50%,-50%)', mixBlendMode: 'screen',
        }} />
        <Stroke text={text} size={size} color={color} style={{position: 'relative'}} />
      </div>
    );
  };

/* A finger touch: ring that fills while holding, label underneath. */
const Touch: React.FC<{x: number; y: number; label?: string; from: number; to: number; fill?: boolean}> =
  ({x, y, label, from, to, fill}) => {
    const frame = useCurrentFrame();
    if (frame < from || frame > to + 6) return null;
    const inS = interpolate(frame, [from, from + 6], [1.6, 1], clamp);
    const out = interpolate(frame, [to, to + 6], [1, 0], clamp);
    const prog = fill ? interpolate(frame, [from + 4, to - 4], [0, 1], clamp) : 0;
    const R = 34;
    const circ = 2 * Math.PI * (R + 6);
    return (
      <div style={{position: 'absolute', left: x, top: y, transform: `translate(-50%,-50%) scale(${inS})`, opacity: out, zIndex: 30}}>
        <div style={{
          width: R * 2, height: R * 2, borderRadius: '50%', background: 'rgba(255,255,255,0.35)',
          border: '4px solid #ffffff', boxShadow: '0 0 24px rgba(255,255,255,0.7)',
        }} />
        {fill && (
          <svg width={(R + 12) * 2} height={(R + 12) * 2} style={{position: 'absolute', left: -12, top: -12, transform: 'rotate(-90deg)'}}>
            <circle cx={R + 12} cy={R + 12} r={R + 6} fill="none" stroke={C.yellow} strokeWidth={6}
              strokeDasharray={circ} strokeDashoffset={circ * (1 - prog)} strokeLinecap="round" />
          </svg>
        )}
        {label && (
          <div style={{
            position: 'absolute', left: '50%', top: R * 2 + 14, transform: 'translateX(-50%)',
            fontFamily: PIXEL, fontSize: 26, color: C.yellow, background: 'rgba(6,8,16,0.9)',
            padding: '4px 12px', borderRadius: 8, border: `2px solid ${C.yellow}`, whiteSpace: 'nowrap',
          }}>{label}</div>
        )}
      </div>
    );
  };

/* ----------------------------------------------------------------- table -- */

const TW = 440, TH = 950;
const FIELD = {x: 20, y: 120, w: 400, h: 640};
const DRAIN_Y = FIELD.y + FIELD.h - 10;
const PIVOT_L = {x: 82, y: 690}, PIVOT_R = {x: 358, y: 690};
const FLIP_LEN = 112;
const SLOTS = [
  {x: 100, y: 230}, {x: 220, y: 230}, {x: 340, y: 230},
  {x: 160, y: 300}, {x: 280, y: 300},
  {x: 100, y: 370}, {x: 220, y: 370}, {x: 340, y: 370},
  {x: 160, y: 440}, {x: 280, y: 440},
  {x: 100, y: 510}, {x: 220, y: 510}, {x: 340, y: 510},
];
export const BUMPER_SLOT = {x: 280, y: 440};
export const PADDLE_SLOT = {x: 160, y: 300};

type Ball = {x: number; y: number; r?: number; color?: string; opacity?: number; fire?: boolean};
type TableProps = {
  lives?: number; energy?: number;
  flipL?: number; flipR?: number;          /* 0 rest .. 1 raised */
  balls?: Ball[];
  slotsGlow?: boolean;
  bumper?: {scale?: number; hit?: number} | null;
  paddle?: {angle: number; power?: boolean} | null;
  trayHi?: 'bumper' | 'paddle' | 'cards' | null;
  startHi?: boolean;
  drainFlash?: number;
  children?: React.ReactNode;
};

const BallDot: React.FC<{b: Ball}> = ({b}) => {
  const r = b.r ?? 16;
  const col = b.fire ? C.orange : (b.color ?? C.grey);
  return (
    <div style={{
      position: 'absolute', left: b.x - r, top: b.y - r, width: r * 2, height: r * 2, borderRadius: '50%',
      background: `radial-gradient(circle at 35% 30%, #ffffff 0%, ${col} 45%, ${b.fire ? '#b03a00' : '#3a3d4c'} 100%)`,
      boxShadow: b.fire ? `0 0 26px ${C.orange}, 0 0 60px ${C.orange}88` : '0 3px 8px rgba(0,0,0,0.7)',
      opacity: b.opacity ?? 1, zIndex: 10,
    }} />
  );
};

const Flipper: React.FC<{side: 'L' | 'R'; up: number}> = ({side, up}) => {
  const p = side === 'L' ? PIVOT_L : PIVOT_R;
  const a = interpolate(up, [0, 1], [30, -22]);
  const rot = side === 'L' ? a : -a;
  const origin = side === 'L' ? '12px 50%' : `${FLIP_LEN - 12}px 50%`;
  const left = side === 'L' ? p.x - 12 : p.x - FLIP_LEN + 12;
  return (
    <div style={{
      position: 'absolute', left, top: p.y - 11, width: FLIP_LEN, height: 22, borderRadius: 11,
      background: `linear-gradient(180deg, #dffbff 0%, ${C.cyan} 50%, #1fb6d8 100%)`,
      boxShadow: `0 0 18px ${C.cyan}`, transformOrigin: origin, transform: `rotate(${rot}deg)`, zIndex: 8,
    }} />
  );
};

const TrayButton: React.FC<{x: number; label: string; cost: string; hi: boolean; kind: 'paddle' | 'bumper'}> =
  ({x, label, cost, hi, kind}) => (
    <div style={{
      position: 'absolute', left: x, top: 800, width: 88, height: 118, borderRadius: 14,
      background: '#0b0f1c', border: `3px solid ${hi ? C.yellow : '#2a3350'}`,
      boxShadow: hi ? `0 0 26px ${C.yellow}` : 'none', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 8,
    }}>
      {kind === 'bumper'
        ? <div style={{width: 34, height: 34, borderRadius: '50%', border: `4px solid ${C.cyan}`, boxShadow: `0 0 10px ${C.cyan}`}} />
        : <div style={{width: 44, height: 12, borderRadius: 6, background: C.cyan, transform: 'rotate(-30deg)', boxShadow: `0 0 10px ${C.cyan}`}} />}
      <div style={{fontFamily: PIXEL, fontSize: 18, color: C.white}}>{label}</div>
      <div style={{fontFamily: PIXEL, fontSize: 16, color: C.yellow}}>{cost}</div>
    </div>
  );

const CARD_COLORS = [C.yellow, C.cyan, '#b56bff', C.pink];
const CARD_NAMES = ['MEGA', 'ZAP', 'WAVE', 'LINE'];

const Table: React.FC<TableProps> = (p) => {
  const lives = p.lives ?? 5;
  const flash = p.drainFlash ?? 0;
  return (
    <div style={{position: 'relative', width: TW, height: TH, background: '#0a0d18', borderRadius: 30, overflow: 'hidden', border: '8px solid #08080e', boxShadow: '0 40px 90px rgba(0,0,0,0.8)'}}>
      {/* HUD */}
      <div style={{position: 'absolute', left: 14, top: 14, width: TW - 28, height: 88, background: '#05070f', borderRadius: 12, border: '2px solid #1c2440'}}>
        <div style={{position: 'absolute', left: 16, top: 22, display: 'flex', gap: 8}}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={{width: 18, height: 18, borderRadius: '50%', background: i < lives ? C.pink : '#2a1a2a', boxShadow: i < lives ? `0 0 10px ${C.pink}` : 'none'}} />
          ))}
        </div>
        <div style={{position: 'absolute', left: 16, top: 52, fontFamily: PIXEL, fontSize: 16, color: C.pink}}>LIVES</div>
        <div style={{position: 'absolute', left: '50%', top: 18, transform: 'translateX(-50%)', fontFamily: PIXEL, fontSize: 34, color: C.white, whiteSpace: 'nowrap'}}>WAVE 1</div>
        <div style={{position: 'absolute', right: 16, top: 16, fontFamily: PIXEL, fontSize: 34, color: C.yellow}}>{p.energy ?? 120}</div>
        <div style={{position: 'absolute', right: 16, top: 54, fontFamily: PIXEL, fontSize: 16, color: C.yellow}}>ENERGY</div>
      </div>

      {/* playfield */}
      <div style={{
        position: 'absolute', left: FIELD.x, top: FIELD.y, width: FIELD.w, height: FIELD.h, borderRadius: 26,
        background: 'radial-gradient(ellipse at 50% 40%, #1a2035 0%, #0d1120 70%)',
        border: `4px solid ${C.cyan}`, boxShadow: `inset 0 0 40px rgba(110,235,255,0.25), 0 0 20px rgba(110,235,255,0.35)`,
      }} />
      {/* drain */}
      <div style={{
        position: 'absolute', left: FIELD.x + 12, top: DRAIN_Y - 3, width: FIELD.w - 24, height: 6, borderRadius: 3,
        background: C.pink, boxShadow: `0 0 ${16 + flash * 40}px ${C.pink}, 0 0 ${40 + flash * 80}px ${C.pink}`,
        opacity: 0.85 + flash * 0.15, zIndex: 6,
      }} />
      {flash > 0 && <div style={{position: 'absolute', left: FIELD.x, top: FIELD.y, width: FIELD.w, height: FIELD.h, borderRadius: 26, background: C.pink, opacity: flash * 0.35, zIndex: 7}} />}

      {/* slots */}
      {SLOTS.map((s, i) => (
        <div key={i} style={{
          position: 'absolute', left: s.x - 12, top: s.y - 12, width: 24, height: 24, borderRadius: '50%',
          background: '#0a0d18', border: `3px solid ${p.slotsGlow ? C.yellow : '#2a3350'}`,
          boxShadow: p.slotsGlow ? `0 0 16px ${C.yellow}` : 'none',
        }} />
      ))}

      {/* start banner */}
      {p.startHi && (
        <div style={{
          position: 'absolute', left: 230, top: 140, width: 170, height: 62, borderRadius: 12,
          background: `linear-gradient(180deg, ${C.yellow}, ${C.orange})`, border: '3px solid #08080e',
          boxShadow: `0 0 26px ${C.yellow}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{fontFamily: PIXEL, fontSize: 28, color: '#08080e'}}>START</div>
          <div style={{fontFamily: PIXEL, fontSize: 16, color: '#08080e'}}>4S  +11 E</div>
        </div>
      )}

      {/* bumper */}
      {p.bumper && (() => {
        const sc = (p.bumper.scale ?? 1) * (1 + (p.bumper.hit ?? 0) * 0.35);
        return (
          <div style={{
            position: 'absolute', left: BUMPER_SLOT.x - 34, top: BUMPER_SLOT.y - 34, width: 68, height: 68, borderRadius: '50%',
            background: `radial-gradient(circle at 40% 35%, #ffffff 0%, ${C.pink} 40%, #7a1a4a 100%)`,
            boxShadow: `0 0 26px ${C.pink}, 0 0 60px ${C.pink}88`, transform: `scale(${sc})`, zIndex: 9,
          }} />
        );
      })()}

      {/* paddle: a bar hinged at the slot, swinging up and inward */}
      {p.paddle && (
        <div style={{position: 'absolute', left: PADDLE_SLOT.x, top: PADDLE_SLOT.y, zIndex: 9}}>
          <div style={{position: 'absolute', left: -14, top: -14, width: 28, height: 28, borderRadius: '50%', background: '#e8fbff', border: `4px solid ${p.paddle.power ? C.orange : C.cyan}`, boxShadow: `0 0 14px ${p.paddle.power ? C.orange : C.cyan}`, zIndex: 2}} />
          <div style={{
            position: 'absolute', left: 0, top: -9, width: 84, height: 18, borderRadius: 9,
            background: p.paddle.power ? `linear-gradient(180deg,#ffe2b0,${C.orange} 55%,#c04a00)` : `linear-gradient(180deg,#dffbff,${C.cyan} 55%,#1fb6d8)`,
            boxShadow: `0 0 18px ${p.paddle.power ? C.orange : C.cyan}`, transformOrigin: '0 50%', transform: `rotate(${p.paddle.angle}deg)`,
          }} />
        </div>
      )}

      {/* flippers */}
      <Flipper side="L" up={p.flipL ?? 0} />
      <Flipper side="R" up={p.flipR ?? 0} />
      {/* lane guides */}
      <div style={{position: 'absolute', left: 30, top: 560, width: 12, height: 150, borderRadius: 6, background: C.cyan, transform: 'rotate(-22deg)', transformOrigin: '50% 0', opacity: 0.8}} />
      <div style={{position: 'absolute', left: 398, top: 560, width: 12, height: 150, borderRadius: 6, background: C.cyan, transform: 'rotate(22deg)', transformOrigin: '50% 0', opacity: 0.8}} />

      {(p.balls ?? []).map((b, i) => <BallDot key={i} b={b} />)}

      {/* tray */}
      <TrayButton x={18} label="PADDLE" cost="55" hi={p.trayHi === 'paddle'} kind="paddle" />
      <TrayButton x={TW - 18 - 88} label="BUMPER" cost="40" hi={p.trayHi === 'bumper'} kind="bumper" />
      {CARD_COLORS.map((c, i) => (
        <div key={i} style={{
          position: 'absolute', left: 118 + i * 52, top: 800, width: 46, height: 118, borderRadius: 10,
          background: '#0b0f1c', border: `3px solid ${p.trayHi === 'cards' ? C.yellow : c}`,
          boxShadow: p.trayHi === 'cards' ? `0 0 20px ${C.yellow}` : `0 0 8px ${c}55`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 8, gap: 6,
        }}>
          <div style={{width: 26, height: 26, borderRadius: '50%', background: c, boxShadow: `0 0 10px ${c}`, marginBottom: 14}} />
          <div style={{fontFamily: PIXEL, fontSize: 11, color: c}}>{CARD_NAMES[i]}</div>
          <div style={{fontFamily: PIXEL, fontSize: 11, color: C.white, background: '#1c2440', padding: '2px 6px', borderRadius: 6}}>TAP</div>
        </div>
      ))}

      {p.children}
    </div>
  );
};

/* ------------------------------------------------------------------ step -- */

const StepCard: React.FC<{n: number; total: number; title: string[]; color: string; body: string; frames: number; children: React.ReactNode}> =
  ({n, total, title, color, body, frames, children}) => {
    const frame = useCurrentFrame();
    const {fps} = useVideoConfig();
    const t0 = spring({frame: frame - 2, fps, config: {damping: 14, stiffness: 200}});
    const t1 = spring({frame: frame - 8, fps, config: {damping: 13, stiffness: 210}});
    const t2 = spring({frame: frame - 16, fps, config: {damping: 13, stiffness: 210}});
    const t3 = spring({frame: frame - 28, fps, config: {damping: 16, stiffness: 160}});
    const tbl = spring({frame: frame - 4, fps, config: {damping: 15, stiffness: 150}});
    const out = interpolate(frame, [frames - 8, frames], [1, 0], clamp);
    return (
      <AbsoluteFill style={{background: C.bg, overflow: 'hidden'}}>
        <Img src={staticFile('art/title_bg.png')} style={{position: 'absolute', width: 1920, height: 1080, objectFit: 'cover', filter: 'blur(30px) brightness(0.35) saturate(1.4)', transform: 'scale(1.2)'}} />
        <AbsoluteFill style={{background: 'radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.75) 100%)'}} />

        <div style={{position: 'absolute', left: 100, top: 170, width: 920}}>
          <div style={{transform: `translateY(${(1 - t0) * -40}px)`, opacity: t0}}>
            <Slab text={`STEP ${n} / ${total}`} color={color} size={30} />
          </div>
          <div style={{marginTop: 34, transform: `translateX(${(1 - t1) * -600}px) rotate(-2deg)`, opacity: t1}}>
            <Stroke text={title[0]} size={150} color={color} />
          </div>
          {title[1] && (
            <div style={{marginTop: 8, transform: `translateX(${(1 - t2) * -600}px) rotate(-2deg)`, opacity: t2}}>
              <Stroke text={title[1]} size={150} color={C.white} />
            </div>
          )}
          <div style={{
            marginTop: 44, transform: `translateY(${(1 - t3) * 50}px)`, opacity: t3,
            fontFamily: PIXEL, fontSize: 40, lineHeight: 1.35, color: C.white, width: 860,
            background: 'rgba(6,8,16,0.85)', border: `3px solid ${color}`, borderRadius: 14, padding: '22px 30px',
          }}>{body}</div>
        </div>

        <div style={{position: 'absolute', left: 1460, top: 540, transform: `translate(-50%,-50%) scale(${interpolate(tbl, [0, 1], [0.9, 1])})`, opacity: tbl}}>
          {children}
        </div>
        <AbsoluteFill style={{background: '#000', opacity: 1 - out, pointerEvents: 'none'}} />
      </AbsoluteFill>
    );
  };

/* ---------------------------------------------------------------- scenes -- */

type SceneDef = {title: string[]; color: string; body: string; frames: number; scene: React.FC};
const TOTAL_STEPS = 8;

/* 1 · the goal: a ball drops, nobody stops it, it hits the drain, one life gone */
const SceneGoal: React.FC = () => {
  const f = useCurrentFrame();
  const y = interpolate(f, [10, 95], [FIELD.y + 20, DRAIN_Y], {...clamp, easing: easeIn});
  const x = interpolate(f, [10, 95], [230, 220], clamp);
  const hit = f >= 95;
  const flash = hit ? interpolate(f, [95, 120], [1, 0], clamp) : 0;
  const arrowBob = Math.sin(f / 5) * 6;
  return (
    <Table lives={hit ? 4 : 5} flipL={0} flipR={0} drainFlash={flash}
      balls={hit ? [] : [{x, y}]}>
      {f > 20 && (
        <div style={{position: 'absolute', left: 220, top: 600 + arrowBob, transform: 'translate(-50%,0)', zIndex: 25, textAlign: 'center'}}>
          <Slab text="THE DRAIN" color={C.pink} size={24} />
          <div style={{fontFamily: IMPACT, fontSize: 44, color: C.pink, lineHeight: 1}}>▼</div>
        </div>
      )}
      {hit && <Sequence from={96} layout="none"><Burst text="-1 LIFE" color={C.pink} x={220} y={520} size={70} /></Sequence>}
    </Table>
  );
};

/* 2 · flippers: ball lands on the left flipper, HOLD the left side, it flies back up */
const SceneFlip: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const drop = interpolate(f, [5, 70], [FIELD.y + 20, 700], {...clamp, easing: easeIn});
  const raise = f >= 84 ? spring({frame: f - 84, fps, config: {damping: 11, stiffness: 300}}) : 0;
  const rest = f >= 150 ? spring({frame: f - 150, fps, config: {damping: 14, stiffness: 120}}) : 0;
  const up = raise * (1 - rest);
  let x = interpolate(f, [5, 70], [150, 125], clamp), y = drop;
  if (f >= 86) {
    y = interpolate(f, [86, 140], [700, 160], {...clamp, easing: easeOut});
    x = interpolate(f, [86, 140], [125, 250], clamp);
  }
  const fade = f >= 140 ? interpolate(f, [140, 165], [1, 0], clamp) : 1;
  return (
    <Table flipL={up} flipR={0} balls={[{x, y, opacity: fade}]}>
      <Touch x={70} y={560} label="HOLD" from={72} to={140} />
      {f >= 88 && <Sequence from={88} layout="none"><Burst text="BAM!" color={C.cyan} x={190} y={640} size={72} hold={26} /></Sequence>}
    </Table>
  );
};

/* 3 · build: tap BUMPER in the tray, then tap a glowing slot */
const SceneBuild: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const chosen = f >= 40;
  const placed = f >= 118;
  const pop = placed ? spring({frame: f - 118, fps, config: {damping: 9, stiffness: 260}}) : 0;
  return (
    <Table energy={placed ? 80 : 120} trayHi={chosen ? 'bumper' : null} slotsGlow={chosen && !placed}
      bumper={placed ? {scale: pop} : null}>
      <Touch x={TW - 18 - 44} y={860} label="TAP" from={22} to={46} />
      <Touch x={BUMPER_SLOT.x} y={BUMPER_SLOT.y} label="TAP A SLOT" from={92} to={122} />
      {placed && <Sequence from={122} layout="none"><Burst text="BUILT!" color={C.yellow} x={230} y={560} size={70} /></Sequence>}
    </Table>
  );
};

/* 4 · bumpers work alone: ball touches it, gets kicked, pops, energy comes in */
const SceneBumper: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const HIT = 62;
  let x = interpolate(f, [8, HIT], [285, 282], clamp);
  let y = interpolate(f, [8, HIT], [FIELD.y + 20, BUMPER_SLOT.y - 48], {...clamp, easing: easeIn});
  if (f >= HIT) {
    x = interpolate(f, [HIT, HIT + 22], [282, 350], clamp);
    y = interpolate(f, [HIT, HIT + 22], [BUMPER_SLOT.y - 48, 330], {...clamp, easing: easeOut});
  }
  const gone = f >= HIT + 22;
  const hit = f >= HIT ? (1 - spring({frame: f - HIT, fps, config: {damping: 8, stiffness: 240}})) : 0;
  const energy = gone ? Math.round(interpolate(f, [HIT + 22, HIT + 50], [80, 95], clamp)) : 80;
  return (
    <Table energy={energy} bumper={{hit}} balls={gone ? [] : [{x, y}]}>
      {f >= HIT && <Sequence from={HIT} layout="none"><Burst text="POW!" color={C.pink} x={300} y={390} size={66} hold={20} /></Sequence>}
      {gone && <Sequence from={HIT + 22} layout="none"><Burst text="+15 ENERGY" color={C.yellow} x={230} y={280} size={52} hold={50} /></Sequence>}
    </Table>
  );
};

/* 5 · paddles: a robot flipper in a slot swings at anything in reach */
const ScenePaddle: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const HIT = 58;
  const swing = f >= HIT ? spring({frame: f - HIT, fps, config: {damping: 10, stiffness: 260}}) : 0;
  const back = f >= HIT + 30 ? spring({frame: f - HIT - 30, fps, config: {damping: 14, stiffness: 110}}) : 0;
  const angle = interpolate(swing * (1 - back), [0, 1], [30, -60]);
  let x = interpolate(f, [8, HIT], [235, 232], clamp);
  let y = interpolate(f, [8, HIT], [FIELD.y + 20, PADDLE_SLOT.y + 40], {...clamp, easing: easeIn});
  if (f >= HIT + 2) {
    x = interpolate(f, [HIT + 2, HIT + 50], [232, 330], clamp);
    y = interpolate(f, [HIT + 2, HIT + 50], [PADDLE_SLOT.y + 40, FIELD.y + 20], {...clamp, easing: easeOut});
  }
  const fade = f >= HIT + 30 ? interpolate(f, [HIT + 30, HIT + 50], [1, 0], clamp) : 1;
  return (
    <Table energy={95} bumper={{}} paddle={{angle}} balls={[{x, y, opacity: fade}]}>
      {f >= HIT + 2 && <Sequence from={HIT + 2} layout="none"><Burst text="WHACK!" color={C.cyan} x={250} y={240} size={62} hold={24} /></Sequence>}
    </Table>
  );
};

/* 6 · upgrades: HOLD the paddle, pick POWER */
const SceneUpgrade: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const open = f >= 66;
  const menu = open ? spring({frame: f - 66, fps, config: {damping: 11, stiffness: 220}}) : 0;
  const power = f >= 126;
  const chip = (label: string, color: string, x: number, hi: boolean) => (
    <div style={{
      position: 'absolute', left: x, top: 170, transform: `translate(-50%,0) scale(${menu})`, zIndex: 22,
      fontFamily: PIXEL, fontSize: 26, color: hi ? '#08080e' : color, background: hi ? color : 'rgba(6,8,16,0.95)',
      border: `3px solid ${color}`, borderRadius: 12, padding: '12px 18px', boxShadow: `0 0 20px ${color}`, whiteSpace: 'nowrap',
    }}>{label}</div>
  );
  return (
    <Table energy={power ? 35 : 95} bumper={{}} paddle={{angle: 30, power}}>
      <Touch x={PADDLE_SLOT.x + 40} y={PADDLE_SLOT.y + 10} label="HOLD" from={14} to={66} fill />
      {open && chip('FROST', C.ice, 150, false)}
      {open && chip('POWER', C.orange, 300, power)}
      <Touch x={300} y={200} label="TAP" from={104} to={128} />
      {power && <Sequence from={128} layout="none"><Burst text="POWER!" color={C.orange} x={230} y={420} size={70} /></Sequence>}
    </Table>
  );
};

/* 7 · ignite: power paddle lights a ball, catch it on a flipper, fire it into the crowd */
const SceneIgnite: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const HIT = 46, CATCH = 100, FIRE = 116, BOOM = 150;
  const swing = f >= HIT ? spring({frame: f - HIT, fps, config: {damping: 10, stiffness: 260}}) : 0;
  const back = f >= HIT + 24 ? spring({frame: f - HIT - 24, fps, config: {damping: 14, stiffness: 110}}) : 0;
  const angle = interpolate(swing * (1 - back), [0, 1], [30, -60]);
  const flipR = f >= FIRE ? spring({frame: f - FIRE, fps, config: {damping: 11, stiffness: 300}}) : 0;

  let x = interpolate(f, [6, HIT], [235, 232], clamp);
  let y = interpolate(f, [6, HIT], [FIELD.y + 20, PADDLE_SLOT.y + 40], {...clamp, easing: easeIn});
  if (f >= HIT + 2) {
    /* a lazy arc over to the right flipper */
    const t = interpolate(f, [HIT + 2, CATCH], [0, 1], clamp);
    x = interpolate(t, [0, 1], [232, 322]);
    y = interpolate(t, [0, 1], [PADDLE_SLOT.y + 40, 700]) - Math.sin(t * Math.PI) * 120;
  }
  if (f >= FIRE + 2) {
    x = interpolate(f, [FIRE + 2, BOOM], [322, 225], clamp);
    y = interpolate(f, [FIRE + 2, BOOM], [700, 225], {...clamp, easing: easeOut});
  }
  const fire = f >= HIT + 2;
  const boom = f >= BOOM;
  const crowd: Ball[] = [[180, 200], [225, 180], [270, 205], [200, 245], [255, 250]].map(([cx, cy]) => ({
    x: cx, y: cy, r: 14, opacity: boom ? interpolate(f, [BOOM, BOOM + 10], [1, 0], clamp) : 1,
  }));
  const energy = boom ? Math.round(interpolate(f, [BOOM, BOOM + 40], [35, 110], clamp)) : 35;
  return (
    <Table energy={energy} bumper={{}} paddle={{angle, power: true}} flipR={flipR}
      balls={[...crowd, {x, y, fire, opacity: boom ? 0 : 1}]}>
      {f >= HIT + 2 && <Sequence from={HIT + 2} layout="none"><Burst text="IGNITED!" color={C.orange} x={240} y={380} size={60} hold={26} /></Sequence>}
      <Touch x={372} y={560} label="HOLD" from={CATCH} to={FIRE + 16} />
      {boom && <Sequence from={BOOM} layout="none"><Burst text="CHAIN x5!" color={C.yellow} x={225} y={215} size={72} hold={60} /></Sequence>}
    </Table>
  );
};

/* 8 · tips: hold a card to read it; tap START to send the wave early */
const SceneTips: React.FC = () => {
  const f = useCurrentFrame();
  const cardsPhase = f < 96;
  const started = f >= 150;
  return (
    <Table energy={started ? 121 : 110} bumper={{}} paddle={{angle: 30, power: true}}
      trayHi={cardsPhase ? 'cards' : null} startHi={f >= 96}>
      <Touch x={141} y={860} label="HOLD TO READ" from={16} to={80} fill />
      {cardsPhase && f > 30 && (
        <div style={{position: 'absolute', left: 60, top: 640, width: 320, zIndex: 22, fontFamily: PIXEL, fontSize: 20, color: C.white, background: 'rgba(6,8,16,0.95)', border: `3px solid ${C.yellow}`, borderRadius: 12, padding: '12px 16px', lineHeight: 1.3}}>
          <div style={{color: C.yellow, fontSize: 24}}>MEGABALL</div>
          One-tap power. Drops a giant ball that wrecks everything it touches.
        </div>
      )}
      <Touch x={315} y={171} label="TAP" from={126} to={152} />
      {started && <Sequence from={150} layout="none"><Burst text="+11 ENERGY" color={C.yellow} x={230} y={330} size={56} hold={50} /></Sequence>}
    </Table>
  );
};

const SCENES: SceneDef[] = [
  {title: ['THE GOAL'], color: C.pink, frames: 180, scene: SceneGoal,
   body: 'Enemy balls drop in from the top and roll for the DRAIN at the bottom. Every ball that gets out costs you a LIFE.'},
  {title: ['FLIP IT'], color: C.cyan, frames: 200, scene: SceneFlip,
   body: 'HOLD the left or right side of the screen to raise that flipper. Flippers knock balls back up the table, but they can never destroy one.'},
  {title: ['BUILD', 'DEFENSES'], color: C.yellow, frames: 190, scene: SceneBuild,
   body: 'Defenses destroy balls for you. Tap BUMPER or PADDLE in the tray, then tap a GLOWING slot on the table.'},
  {title: ['BUMPERS'], color: C.pink, frames: 170, scene: SceneBumper,
   body: 'Bumpers need no input at all. They damage and kick anything that touches them. Every kill pays out ENERGY. Spend it on more defenses.'},
  {title: ['PADDLES'], color: C.cyan, frames: 160, scene: ScenePaddle,
   body: 'A paddle is a robot flipper. It swings at anything in reach, up and in toward the middle of the table.'},
  {title: ['UPGRADES'], color: C.orange, frames: 200, scene: SceneUpgrade,
   body: 'HOLD a defense to open its upgrades. FROST slows what it hits. POWER turns the ball it hits into a WEAPON.'},
  {title: ['USE THEIR', 'BALLS'], color: C.orange, frames: 240, scene: SceneIgnite,
   body: 'An ignited ball is YOUR shot. Let it fall onto a flipper, then HOLD that side to fire it into the crowd for a chain reaction.'},
  {title: ['PRO TIPS'], color: C.yellow, frames: 220, scene: SceneTips,
   body: 'Cards in the tray are one-tap powers. HOLD one to read it. Built early? Tap START to send the wave now and get paid for every second you hand back.'},
];

/* ------------------------------------------------------------ title/outro -- */

const TITLE = 90, OUTRO = 100;

const Title: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const logo = spring({frame: frame - 6, fps, config: {damping: 12, stiffness: 200}});
  const l1 = spring({frame: frame - 30, fps, config: {damping: 12, stiffness: 200}});
  const out = interpolate(frame, [TITLE - 8, TITLE], [1, 0], clamp);
  return (
    <AbsoluteFill style={{background: C.bg, overflow: 'hidden'}}>
      <Img src={staticFile('art/title_bg.png')} style={{position: 'absolute', width: 1920, height: 1080, objectFit: 'cover', transform: `scale(${1.1 - frame * 0.001})`, filter: 'brightness(0.7)'}} />
      <AbsoluteFill style={{background: 'radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.8) 100%)'}} />
      <div style={{position: 'absolute', left: 960, top: 380, transform: `translate(-50%,-50%) scale(${interpolate(logo, [0, 1], [2.2, 1])})`, opacity: logo}}>
        <Img src={staticFile('art/logo.png')} style={{width: 1180, filter: 'drop-shadow(0 0 40px rgba(86,230,255,0.8))'}} />
      </div>
      <div style={{position: 'absolute', left: 960, top: 680, transform: `translate(-50%,0) scale(${l1})`, opacity: l1}}>
        <Stroke text="HOW TO PLAY" size={150} color={C.yellow} />
      </div>
      <AbsoluteFill style={{background: '#000', opacity: 1 - out}} />
    </AbsoluteFill>
  );
};

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const logo = spring({frame: frame - 4, fps, config: {damping: 12, stiffness: 200}});
  const l1 = spring({frame: frame - 24, fps, config: {damping: 12, stiffness: 200}});
  const l2 = spring({frame: frame - 40, fps, config: {damping: 12, stiffness: 200}});
  const fade = interpolate(frame, [OUTRO - 20, OUTRO], [1, 0], clamp);
  return (
    <AbsoluteFill style={{background: C.bg, overflow: 'hidden'}}>
      <Img src={staticFile('art/title_bg.png')} style={{position: 'absolute', width: 1920, height: 1080, objectFit: 'cover', transform: `scale(${1 + frame * 0.0015})`, filter: 'brightness(0.7)'}} />
      <AbsoluteFill style={{background: 'radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.8) 100%)'}} />
      <div style={{position: 'absolute', left: 960, top: 360, transform: `translate(-50%,-50%) scale(${interpolate(logo, [0, 1], [2.2, 1])})`, opacity: logo}}>
        <Img src={staticFile('art/logo.png')} style={{width: 1180, filter: 'drop-shadow(0 0 40px rgba(86,230,255,0.8))'}} />
      </div>
      <div style={{position: 'absolute', left: 960, top: 660, transform: `translate(-50%,0) scale(${l1})`, opacity: l1}}>
        <Stroke text="THAT IS THE GAME" size={132} color={C.yellow} />
      </div>
      <div style={{position: 'absolute', left: 960, top: 830, transform: `translate(-50%,0) translateY(${(1 - l2) * 50}px)`, opacity: l2}}>
        <Slab text="HOLD THE LINE  ·  BUILD  ·  IGNITE  ·  GOOD LUCK" color={C.cyan} size={40} />
      </div>
      <AbsoluteFill style={{background: '#000', opacity: 1 - fade}} />
    </AbsoluteFill>
  );
};

/* ----------------------------------------------------------------- root --- */

export const TUTORIAL_FRAMES = TITLE + SCENES.reduce((a, s) => a + s.frames, 0) + OUTRO;

export const Tutorial: React.FC = () => {
  usePixelFont();
  let at = TITLE;
  const seqs = SCENES.map((s, i) => {
    const from = at;
    at += s.frames;
    const Scene = s.scene;
    return (
      <Sequence key={i} from={from} durationInFrames={s.frames}>
        <StepCard n={i + 1} total={TOTAL_STEPS} title={s.title} color={s.color} body={s.body} frames={s.frames}>
          <Scene />
        </StepCard>
      </Sequence>
    );
  });
  return (
    <AbsoluteFill style={{background: C.bg}}>
      <Audio src={staticFile('music.mp3')} volume={(f) => 0.35 * interpolate(f, [TUTORIAL_FRAMES - 45, TUTORIAL_FRAMES], [1, 0], clamp)} />
      <Sequence from={0} durationInFrames={TITLE}><Title /></Sequence>
      {seqs}
      <Sequence from={at} durationInFrames={OUTRO}><Outro /></Sequence>
    </AbsoluteFill>
  );
};
