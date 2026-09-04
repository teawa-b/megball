import React, {useEffect, useState} from 'react';
import {
  AbsoluteFill, Audio, Img, Sequence, interpolate, spring, staticFile,
  useCurrentFrame, useVideoConfig, Easing, continueRender, delayRender,
} from 'remotion';

export const FPS = 30;

/* ------------------------------------------------------------------ plan --
 * Every gameplay clip is a JPEG frame sequence captured straight off the
 * game's canvases at 30 fps (see docs/BUILD_LOG.md). Frame N of a section
 * shows frame N of its clip, so the cuts are frame-accurate. */
type Section = {
  clip: string; frames: number; title: string[]; sub?: string;
  color: string; sfx?: {at: number; text: string; color: string};
  zoom?: {at: number; x: number; y: number; scale: number};
};

const SECTIONS: Section[] = [
  {clip: 'build', frames: 150, title: ['BUILD', 'YOUR TABLE'], sub: 'PADDLES + BUMPERS FIGHT FOR YOU',
   color: '#ffdc28', zoom: {at: 138, x: 0.64, y: 0.24, scale: 1.7}},
  {clip: 'wave', frames: 150, title: ['THE ENEMIES', 'ARE THE BALLS'], sub: 'HOLD THE LINE ON YOUR FLIPPERS',
   color: '#6eebff', sfx: {at: 70, text: 'BAM!', color: '#6eebff'}},
  {clip: 'mega', frames: 120, title: ['USE THEIR BALLS', 'AGAINST THEM'], sub: 'ONE IGNITED BALL WRECKS THE REST',
   color: '#ff9c28', sfx: {at: 31, text: 'IGNITED!', color: '#ff9c28'}, zoom: {at: 31, x: 0.5, y: 0.7, scale: 1.45}},
  {clip: 'freeze', frames: 120, title: ['FREEZE', 'THEM SOLID'], sub: 'FLASH FREEZE SLOWS THE WHOLE TABLE',
   color: '#c8f5ff', sfx: {at: 36, text: 'KRRSH!', color: '#c8f5ff'}},
  {clip: 'boss', frames: 150, title: ['DEFEAT', 'THE BOSS'], sub: 'COLOSSUS · 240 HP · 3 PHASES',
   color: '#ff46a0', sfx: {at: 61, text: 'BOOM!', color: '#ffdc28'}, zoom: {at: 61, x: 0.5, y: 0.42, scale: 1.5}},
  {clip: 'endless', frames: 150, title: ['CAN YOU REACH', 'WAVE 20?'], sub: 'ENDLESS MODE · A BOSS EVERY 5 WAVES',
   color: '#ffdc28', sfx: {at: 71, text: 'IGNITED!', color: '#ff9c28'}},
];

const INTRO = 96;
const OUTRO = 110;
export const TRAILER_FRAMES = INTRO + SECTIONS.reduce((a, s) => a + s.frames, 0) + OUTRO;

const IMPACT = 'Impact, "Arial Narrow Bold", sans-serif';

/* ------------------------------------------------------------- helpers --- */

const usePixelFont = () => {
  const [handle] = useState(() => delayRender('kenpixel'));
  useEffect(() => {
    /* the raw TTF fails Chrome's OTS sanitiser; the WOFF the game ships is fine */
    const f = new FontFace('KenPixel', `url(${staticFile('fonts/kenpixel.woff')})`);
    f.load().then((face) => { document.fonts.add(face); continueRender(handle); })
      .catch(() => continueRender(handle));
  }, [handle]);
};

const pad4 = (n: number) => String(Math.max(0, n)).padStart(4, '0');

const shakeXY = (frame: number, amp: number, from: number, decay = 10) => {
  const t = frame - from;
  if (t < 0) return {x: 0, y: 0};
  const a = amp * Math.exp(-t / decay);
  return {x: Math.sin(t * 7.3) * a, y: Math.cos(t * 9.1) * a};
};

const Stroke: React.FC<{
  text: string; size: number; color: string; style?: React.CSSProperties; sw?: number;
}> = ({text, size, color, style, sw = 0.09}) => (
  <div style={{
    fontFamily: IMPACT, fontSize: size, color, lineHeight: 0.92, letterSpacing: 1,
    WebkitTextStroke: `${size * sw}px #08080e`, paintOrder: 'stroke fill',
    textShadow: `${size * 0.06}px ${size * 0.07}px 0 #08080e`, whiteSpace: 'nowrap', ...style,
  }}>{text}</div>
);

const PixelSlab: React.FC<{text: string; color: string; size?: number; style?: React.CSSProperties}> =
  ({text, color, size = 34, style}) => (
    <div style={{
      fontFamily: 'KenPixel, monospace', fontSize: size, color, background: 'rgba(6,8,16,0.92)',
      border: `3px solid ${color}`, borderRadius: 10, padding: '10px 22px', letterSpacing: 1,
      whiteSpace: 'nowrap', ...style,
    }}>{text}</div>
  );

/* Comic starburst word: Codex-generated burst sprite (black keyed out with
 * screen blend) behind Impact lettering, popping in on a spring. */
const Burst: React.FC<{text: string; color: string; x: number; y: number; size?: number}> =
  ({text, color, x, y, size = 150}) => {
    const frame = useCurrentFrame();
    const {fps} = useVideoConfig();
    const s = spring({frame, fps, config: {damping: 9, stiffness: 260, mass: 0.7}});
    const rot = interpolate(frame, [0, 12], [-14, -6], {extrapolateRight: 'clamp'});
    const fade = interpolate(frame, [22, 34], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
    return (
      <div style={{position: 'absolute', left: x, top: y, transform: `translate(-50%,-50%) scale(${s}) rotate(${rot}deg)`, opacity: fade}}>
        <Img src={staticFile('art/burst.png')} style={{
          position: 'absolute', left: '50%', top: '50%', width: size * 4.2, height: size * 4.2,
          transform: 'translate(-50%,-50%)', mixBlendMode: 'screen',
        }} />
        <Stroke text={text} size={size} color={color} style={{position: 'relative'}} />
      </div>
    );
  };

const Flash: React.FC<{color?: string; frames?: number}> = ({color = '#ffffff', frames = 7}) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, frames], [0.8, 0], {extrapolateRight: 'clamp'});
  return <AbsoluteFill style={{background: color, opacity: o, pointerEvents: 'none'}} />;
};

const SpeedLines: React.FC<{opacity: number; scale?: number}> = ({opacity, scale = 1}) => {
  const frame = useCurrentFrame();
  return (
    <Img src={staticFile('art/speedlines.png')} style={{
      position: 'absolute', left: '50%', top: '50%', width: 2400, height: 1350,
      transform: `translate(-50%,-50%) scale(${scale}) rotate(${(frame % 3) * 2}deg)`,
      mixBlendMode: 'multiply', opacity,
    }} />
  );
};

/* ---------------------------------------------------------------- intro --- */

const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const bgScale = interpolate(frame, [0, INTRO], [1.18, 1.0]);
  const logoS = spring({frame: frame - 10, fps, config: {damping: 11, stiffness: 240, mass: 0.9}});
  const logoScale = interpolate(logoS, [0, 1], [3.6, 1]);
  const sh = shakeXY(frame, 26, 18, 8);
  const l1 = spring({frame: frame - 40, fps, config: {damping: 12, stiffness: 200}});
  const l2 = spring({frame: frame - 50, fps, config: {damping: 12, stiffness: 200}});
  const l3 = spring({frame: frame - 60, fps, config: {damping: 12, stiffness: 200}});
  const out = interpolate(frame, [INTRO - 8, INTRO], [1, 0], {extrapolateLeft: 'clamp'});
  return (
    <AbsoluteFill style={{background: '#05060c', overflow: 'hidden'}}>
      <Img src={staticFile('art/title_bg.png')} style={{
        position: 'absolute', width: 1920, height: 1080, objectFit: 'cover',
        transform: `scale(${bgScale}) translate(${sh.x * 0.3}px, ${sh.y * 0.3}px)`,
      }} />
      <AbsoluteFill style={{background: 'radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.75) 100%)'}} />
      {frame >= 18 && frame < 30 && <Flash frames={10} />}
      <div style={{position: 'absolute', left: 960, top: 380, transform: `translate(-50%,-50%) translate(${sh.x}px,${sh.y}px) scale(${logoScale})`, opacity: frame < 10 ? 0 : 1}}>
        <Img src={staticFile('art/logo.png')} style={{width: 1280, filter: 'drop-shadow(0 0 40px rgba(86,230,255,0.8))'}} />
      </div>
      <div style={{position: 'absolute', left: 960, top: 720, transform: 'translate(-50%,0)', display: 'flex', gap: 40, alignItems: 'baseline'}}>
        <div style={{transform: `translateY(${(1 - l1) * 160}px) rotate(-3deg)`, opacity: l1}}><Stroke text="PINBALL" size={126} color="#6eebff" /></div>
        <div style={{transform: `translateY(${(1 - l2) * 160}px)`, opacity: l2}}><Stroke text="MEETS" size={76} color="#ffffff" /></div>
        <div style={{transform: `translateY(${(1 - l3) * 160}px) rotate(3deg)`, opacity: l3}}><Stroke text="TOWER DEFENSE" size={126} color="#ffdc28" /></div>
      </div>
      <AbsoluteFill style={{background: '#000', opacity: 1 - out}} />
    </AbsoluteFill>
  );
};

/* -------------------------------------------------------------- section --- */

const Section: React.FC<{s: Section}> = ({s}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const src = staticFile(`clips/${s.clip}/${pad4(Math.min(frame, s.frames - 1))}.jpg`);

  /* the phone: 880x1900 source, standing 1000 tall, punch-in on the beat */
  const PH = 1000, PW = PH * 880 / 1900;
  const drift = interpolate(frame, [0, s.frames], [1.0, 1.08]);
  let zoom = 1, ox = 0, oy = 0;
  if (s.zoom && frame >= s.zoom.at) {
    const z = spring({frame: frame - s.zoom.at, fps, config: {damping: 14, stiffness: 120}});
    zoom = interpolate(z, [0, 1], [1, s.zoom.scale]);
    ox = -(s.zoom.x - 0.5) * PW * (zoom - 1);
    oy = -(s.zoom.y - 0.5) * PH * (zoom - 1);
  }
  const sh = s.sfx ? shakeXY(frame, 22, s.sfx.at, 7) : {x: 0, y: 0};

  const t1 = spring({frame: frame - 4, fps, config: {damping: 13, stiffness: 210}});
  const t2 = spring({frame: frame - 12, fps, config: {damping: 13, stiffness: 210}});
  const t3 = spring({frame: frame - 26, fps, config: {damping: 16, stiffness: 160}});
  const outFade = interpolate(frame, [s.frames - 6, s.frames], [1, 0], {extrapolateLeft: 'clamp'});
  const speedOp = s.sfx ? interpolate(frame, [s.sfx.at, s.sfx.at + 4, s.sfx.at + 26], [0, 0.55, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}) : 0;

  return (
    <AbsoluteFill style={{background: '#05060c', overflow: 'hidden'}}>
      {/* backdrop: the same clip, blown up and blurred */}
      <Img src={src} style={{
        position: 'absolute', left: '50%', top: '50%', width: 1920 * 1.3, height: 1920 * 1.3 * 1900 / 880,
        transform: `translate(-50%,-50%) translate(${sh.x * 0.5}px,${sh.y * 0.5}px)`, objectFit: 'cover',
        filter: 'blur(38px) brightness(0.55) saturate(1.6)',
      }} />
      <AbsoluteFill style={{background: 'radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 35%, rgba(0,0,0,0.7) 100%)'}} />
      <SpeedLines opacity={speedOp} />

      {/* the phone */}
      <div style={{
        position: 'absolute', left: 960 + 260, top: 540, width: PW, height: PH,
        transform: `translate(-50%,-50%) translate(${sh.x}px,${sh.y}px) scale(${drift})`,
        borderRadius: 34, overflow: 'hidden', border: '8px solid #08080e',
        boxShadow: `0 0 0 4px ${s.color}cc, 0 40px 90px rgba(0,0,0,0.8)`,
      }}>
        <Img src={src} style={{
          width: PW, height: PH, transform: `translate(${ox}px,${oy}px) scale(${zoom})`,
        }} />
      </div>

      {/* kinetic headline, left column */}
      <div style={{position: 'absolute', left: 90, top: 250}}>
        <div style={{transform: `translateX(${(1 - t1) * -700}px) rotate(-2deg)`, opacity: t1}}>
          <Stroke text={s.title[0]} size={190} color={s.color} />
        </div>
        <div style={{transform: `translateX(${(1 - t2) * -700}px) rotate(-2deg)`, opacity: t2, marginTop: 6}}>
          <Stroke text={s.title[1]} size={190} color="#ffffff" />
        </div>
        {s.sub && (
          <div style={{transform: `translateY(${(1 - t3) * 60}px)`, opacity: t3, marginTop: 40, display: 'inline-block'}}>
            <PixelSlab text={s.sub} color={s.color} />
          </div>
        )}
      </div>

      {s.sfx && frame >= s.sfx.at && (
        <Sequence from={s.sfx.at} layout="none">
          <Flash color="#ffffff" frames={5} />
          <Burst text={s.sfx.text} color={s.sfx.color} x={640} y={960} />
        </Sequence>
      )}
      <AbsoluteFill style={{background: '#000', opacity: 1 - outFade}} />
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- outro --- */

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const logoS = spring({frame: frame - 6, fps, config: {damping: 12, stiffness: 200}});
  const l1 = spring({frame: frame - 30, fps, config: {damping: 12, stiffness: 200}});
  const l2 = spring({frame: frame - 44, fps, config: {damping: 12, stiffness: 200}});
  const fade = interpolate(frame, [OUTRO - 20, OUTRO], [1, 0], {extrapolateLeft: 'clamp'});
  return (
    <AbsoluteFill style={{background: '#05060c', overflow: 'hidden'}}>
      <Img src={staticFile('art/title_bg.png')} style={{position: 'absolute', width: 1920, height: 1080, objectFit: 'cover', transform: `scale(${1 + frame * 0.0015})`, filter: 'brightness(0.7)'}} />
      <AbsoluteFill style={{background: 'radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.8) 100%)'}} />
      <div style={{position: 'absolute', left: 960, top: 360, transform: `translate(-50%,-50%) scale(${interpolate(logoS, [0, 1], [2.2, 1])})`, opacity: logoS}}>
        <Img src={staticFile('art/logo.png')} style={{width: 1180, filter: 'drop-shadow(0 0 40px rgba(86,230,255,0.8))'}} />
      </div>
      <div style={{position: 'absolute', left: 960, top: 660, transform: `translate(-50%,0) scale(${l1})`, opacity: l1}}>
        <Stroke text="PLAY FREE IN YOUR BROWSER" size={132} color="#ffdc28" />
      </div>
      <div style={{position: 'absolute', left: 960, top: 830, transform: `translate(-50%,0) translateY(${(1 - l2) * 50}px)`, opacity: l2}}>
        <PixelSlab text="NO INSTALL  ·  ONE HAND  ·  PORTRAIT" color="#6eebff" size={40} />
      </div>
      <AbsoluteFill style={{background: '#000', opacity: 1 - fade}} />
    </AbsoluteFill>
  );
};

/* -------------------------------------------------------------- trailer --- */

export const Trailer: React.FC = () => {
  usePixelFont();
  let at = 0;
  const seqs = SECTIONS.map((s) => {
    const from = at;
    at += s.frames;
    return (
      <Sequence key={s.clip} from={from} durationInFrames={s.frames}>
        <Section s={s} />
      </Sequence>
    );
  });
  return (
    <AbsoluteFill style={{background: '#05060c'}}>
      <Audio src={staticFile('music.mp3')} volume={(f) => interpolate(f, [TRAILER_FRAMES - 45, TRAILER_FRAMES], [1, 0], {extrapolateLeft: 'clamp'})} />
      <Sequence from={0} durationInFrames={INTRO}><Intro /></Sequence>
      <Sequence from={INTRO} durationInFrames={at}>{seqs}</Sequence>
      <Sequence from={INTRO + at} durationInFrames={OUTRO}><Outro /></Sequence>
    </AbsoluteFill>
  );
};
