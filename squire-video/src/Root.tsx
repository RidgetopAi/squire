import React from 'react';
import {Composition} from 'remotion';
import {SquireVideo} from './SquireVideo';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="SquireVideo"
        component={SquireVideo}
        durationInFrames={2970}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
