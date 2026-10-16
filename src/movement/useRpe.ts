// The RPE model, learned from everything you've logged and filmed, for any screen.
import { useMemo } from 'react';
import { useNotes } from '../hooks/useData';
import { useMediaLoaded } from '../media/media';
import { useBodyDims } from '../profile/profile';
import { learnRpe, observations, type RpeLearner, type SetObservation } from './rpe';

export function useRpe(): { obs: SetObservation[]; learner: RpeLearner } {
  const notes = useNotes();
  const { media } = useMediaLoaded();
  const dims = useBodyDims();
  return useMemo(() => {
    const obs = observations(notes, media, dims.height);
    return { obs, learner: learnRpe(obs) };
  }, [notes, media, dims.height]);
}

/** "RPE 8" or "RPE 8.5", to the nearest half ("RPE 5 or less" at the bottom of the scale, where it's guesswork). */
export const fmtRpe = (r: number) => (r <= 5 ? 'RPE 5 or less' : `RPE ${Math.round(r * 2) / 2}`);
