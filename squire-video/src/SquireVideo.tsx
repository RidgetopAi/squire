import React from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile} from 'remotion';
import {colors} from './theme';

import {Scene01Hook} from './scenes/Scene01Hook';
import {Scene02Problem} from './scenes/Scene02Problem';
import {Scene03StoryEngine} from './scenes/Scene03StoryEngine';
import {Scene04Salience} from './scenes/Scene04Salience';
import {Scene05Beliefs} from './scenes/Scene05Beliefs';
import {Scene06Consolidation} from './scenes/Scene06Consolidation';
import {Scene07Agent} from './scenes/Scene07Agent';
import {Scene08Tools} from './scenes/Scene08Tools';
import {Scene09TechStack} from './scenes/Scene09TechStack';
import {Scene10Dashboard} from './scenes/Scene10Dashboard';
import {Scene11Stats} from './scenes/Scene11Stats';
import {Scene12Closing} from './scenes/Scene12Closing';

// Scene timing (frames at 30fps) — each scene +2s from original
const scenes = [
  {component: Scene01Hook, duration: 240, name: 'Hook'},              // 0-8s
  {component: Scene02Problem, duration: 240, name: 'Problem'},         // 8-16s
  {component: Scene03StoryEngine, duration: 300, name: 'Story'},       // 16-26s
  {component: Scene04Salience, duration: 270, name: 'Salience'},       // 26-35s
  {component: Scene05Beliefs, duration: 240, name: 'Beliefs'},         // 35-43s
  {component: Scene06Consolidation, duration: 270, name: 'Consolidation'}, // 43-52s
  {component: Scene07Agent, duration: 360, name: 'Agent'},             // 52-64s
  {component: Scene08Tools, duration: 270, name: 'Tools'},             // 64-73s
  {component: Scene09TechStack, duration: 240, name: 'TechStack'},     // 73-81s
  {component: Scene10Dashboard, duration: 240, name: 'Dashboard'},     // 81-89s
  {component: Scene11Stats, duration: 180, name: 'Stats'},             // 89-95s
  {component: Scene12Closing, duration: 120, name: 'Closing'},         // 95-99s
];

export const SquireVideo: React.FC = () => {
  let offset = 0;

  return (
    <AbsoluteFill style={{background: colors.bg}}>
      {/* @ts-expect-error Remotion v4 type mismatch */}
      <Audio src={staticFile('Chrome_Dystopia.wav')} volume={0.5} startFrom={356} />
      {scenes.map((scene) => {
        const from = offset;
        offset += scene.duration;
        const SceneComponent = scene.component;
        return (
          <Sequence key={scene.name} from={from} durationInFrames={scene.duration} name={scene.name}>
            <SceneComponent />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
