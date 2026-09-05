import {Composition} from 'remotion';
import {Trailer, TRAILER_FRAMES, FPS} from './Trailer';
import {Tutorial, TUTORIAL_FRAMES} from './Tutorial';

export const RemotionRoot = () => (
  <>
    <Composition
      id="Trailer"
      component={Trailer}
      durationInFrames={TRAILER_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
    />
    <Composition
      id="Tutorial"
      component={Tutorial}
      durationInFrames={TUTORIAL_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
    />
  </>
);
